use tauri_plugin_dialog::DialogExt;
use std::fs;
use std::path::PathBuf;
use epub::doc::EpubDoc;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use tauri::Manager; // 🌟 Necessário para acessar o app_handle e mapear as pastas do SO de forma segura

#[derive(Serialize, Deserialize)]
struct ExtractedChapter {
    id: String,
    title: String,
    content: String,
}

// Struct espelho para transportar os dados do projeto estruturados entre o React e o Rust
#[derive(Serialize, Deserialize)]
struct CachePayload {
    epub_path: String,
    target_language: String,
    engine: String,
    chapters: serde_json::Value, // Captura a árvore de capítulos modificada como JSON genérico dinâmico
}

#[tauri::command]
async fn selecionar_epub(app: tauri::AppHandle) -> Result<String, String> {
    // Converts the Tauri Dialog v2 Picker channel to return paths safely
    let file_path = app.dialog()
        .file()
        .add_filter("Ebook EPUB", &["epub"])
        .blocking_pick_file();

    match file_path {
        Some(path) => Ok(path.to_string()),
        None => Err("No file selected".to_string()),
    }
}

// ==========================================================================
// ⚙️ ROBUST AND FAULT-TOLERANT EPUB CHAPTER EXTRACTION ENGINE
// ==========================================================================
#[tauri::command]
async fn extract_epub_chapters(path: String) -> Result<Vec<ExtractedChapter>, String> {
    let mut doc = EpubDoc::new(path).map_err(|e| e.to_string())?;
    let mut extracted = Vec::new();
    
    let spine_ids = doc.spine.clone();
    let mut counter = 1;

    for spine_item in spine_ids {
        let target_id = match &spine_item.id {
            Some(id_str) => Some(id_str.clone()),
            None => Some(spine_item.idref.clone()),
        };

        if let Some(id_str) = target_id {
            if let Some((content_bytes, _mime)) = doc.get_resource(&id_str) {
                let html_text = String::from_utf8_lossy(&content_bytes).to_string();
                
                let title = doc.toc.iter()
                    .find(|entry| entry.content.to_string_lossy().contains(&id_str))
                    .map(|entry| entry.label.clone())
                    .unwrap_or_else(|| format!("Chapter {}", counter));

                extracted.push(ExtractedChapter {
                    id: id_str,
                    title,
                    content: html_text,
                });
                counter += 1;
                continue;
            }
        }

        if let Some(content_bytes) = doc.get_resource_by_path(&spine_item.idref) {
            let html_text = String::from_utf8_lossy(&content_bytes).to_string();
            
            let title = doc.toc.iter()
                .find(|entry| entry.content.to_string_lossy().contains(&spine_item.idref))
                .map(|entry| entry.label.clone())
                .unwrap_or_else(|| format!("Chapter {}", counter));

            extracted.push(ExtractedChapter {
                id: spine_item.idref.clone(),
                title,
                content: html_text,
            });
            counter += 1;
        }
    }

    // LAYER 4 FALLBACK: Usando agora os campos corretos mapeados pelo compilador (mime e path)
    if extracted.is_empty() {
        let resources = doc.resources.clone();
        for (id_str, resource_item) in resources {
            let lower_mime = resource_item.mime.to_lowercase();
            let lower_path = resource_item.path.to_string_lossy().to_lowercase();
            
            if lower_mime.contains("html") || lower_mime.contains("xml") || lower_path.ends_with(".xhtml") || lower_path.ends_with(".html") {
                if let Some((content_bytes, _)) = doc.get_resource(&id_str) {
                    let html_text = String::from_utf8_lossy(&content_bytes).to_string();
                    
                    let title = doc.toc.iter()
                        .find(|entry| entry.content.to_string_lossy().contains(&id_str))
                        .map(|entry| entry.label.clone())
                        .unwrap_or_else(|| format!("Section {}", counter));

                    extracted.push(ExtractedChapter {
                        id: id_str,
                        title,
                        content: html_text,
                    });
                    counter += 1;
                }
            }
        }
    }

    Ok(extracted)
}

#[tauri::command]
async fn ler_arquivo_texto(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn salvar_arquivo_texto(path: String, conteudo: String) -> Result<(), String> {
    fs::write(path, conteudo).map_err(|e| e.to_string())
}

// ==========================================================================
// 💾 NATIVE FILE PERSISTENCE & AUTOMATIC SESSION CACHE HOOKS
// ==========================================================================
#[tauri::command]
async fn salvar_progresso_cache(app: tauri::AppHandle, key_nome: String, payload: CachePayload) -> Result<(), String> {
    // Resolve dinamicamente a pasta de dados do sistema operacional padrão (AppData/Roaming no Windows)
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    
    // Garante que o diretório específico do aplicativo exista fisicamente em disco
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    
    // Adiciona o nome do arquivo único baseado na combinação do Livro + Idioma Alvo
    path.push(format!("{}.json", key_nome));
    
    // Serializa o estado atualizado do React estruturado de forma legível
    let json_content = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    
    // Grava de forma síncrona protegida e segura na partição
    fs::write(path, json_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn carregar_progresso_cache(app: tauri::AppHandle, key_nome: String) -> Result<Option<CachePayload>, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push(format!("{}.json", key_nome));
    
    // Se não há histórico salvo para este livro e idioma, retorna Option::None pacificamente
    if !path.exists() {
        return Ok(None);
    }
    
    // Caso exista, intercepta o JSON, reconstrói o mapa de dados estruturado e despacha de volta para o React
    let json_content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let data: CachePayload = serde_json::from_str(&json_content).map_err(|e| e.to_string())?;
    
    Ok(Some(data))
}

// ==========================================================================
// 🌐 ACTIVE CORE GOOGLE FREE TRANSLATE API IPC BRIDGE
// ==========================================================================
#[tauri::command]
async fn translate_text_free(text: String, target_lang: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok("".to_string());
    }

    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={}&dt=t&q={}",
        target_lang,
        urlencoding::encode(&text)
    );

    let client = Client::new();
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(|e| format!("Network query failed: {}", e))?;

    let json_array: serde_json::Value = res.json()
        .await
        .map_err(|e| format!("Failed parsing target JSON matrix data: {}", e))?;

    let mut full_translation = String::new();
    if let Some(sentences) = json_array.get(0).and_then(|v| v.as_array()) {
        for sentence in sentences {
            if let Some(translated_chunk) = sentence.get(0).and_then(|v| v.as_str()) {
                full_translation.push_str(translated_chunk);
            }
        }
        return Ok(full_translation);
    }

    Err("Invalid data shape received from translation array parser nodes".to_string())
}

// ==========================================================================
// 🤖 ACTIVE CORE OFFICIAL GOOGLE GEMINI LLM IPC BRIDGE
// ==========================================================================
#[tauri::command]
async fn translate_text_gemini(text: String, target_lang: String, key: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok("".to_string());
    }
    if key.trim().is_empty() {
        return Err("API Key missing parameter".to_string());
    }

    // Targets the modern official v1beta production models API payload architecture
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
        key
    );

    // Build strict context validation instructions keeping translation layouts accurate
    let prompt_instruction = format!(
        "Translate the following textual segment strictly into language code '{}'. Keep the spacing and paragraphs exact. Return ONLY the direct translation text with no notes or introductory conversational elements:\n\n{}",
        target_lang, text
    );

    let payload = serde_json::json!({
        "contents": [{
            "parts": [{
                "text": prompt_instruction
            }]
        }]
    });

    let client = Client::new();
    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Gemini connection failure: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API responded with error status: {}", err_body));
    }

    let json_res: serde_json::Value = res.json()
        .await
        .map_err(|e| format!("Failed parsing response payload: {}", e))?;

    // Safe multi-tier nested unwrap extracting content arrays safely out of Gemini response models
    if let Some(translated_text) = json_res
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|a| a.get(0))
        .and_then(|first| first.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .and_then(|p_arr| p_arr.get(0))
        .and_then(|text_node| text_node.get("text"))
        .and_then(|t_str| t_str.as_str()) 
    {
        return Ok(translated_text.to_string());
    }

    Err("Gemini API structure returned unexpected metadata nodes".to_string())
}

// ==========================================================================
// 🚀 RUNNER INSTANTIATION LIFECYCLE
// ==========================================================================
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            selecionar_epub,
            ler_arquivo_texto,
            salvar_arquivo_texto,
            extract_epub_chapters,
            salvar_progresso_cache,   // 🌟 NOVA PONTE CONECTADA AO FLUXO AUTOMÁTICO DE SALVAMENTO
            carregar_progresso_cache, // 🌟 NOVA PONTE CONECTADA AO SELETOR DE ARQUIVOS
            translate_text_free,      
            translate_text_gemini     
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}