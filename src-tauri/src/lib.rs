// src-tauri/src/lib.rs

use percent_encoding::percent_decode_str;
use reqwest::Client;
use roxmltree::Document;
use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::time::sleep;
use zip::ZipArchive;

const GOOGLE_FREE_ENDPOINT: &str =
    "https://translate.googleapis.com/translate_a/single";

const GEMINI_MODEL: &str = "gemini-flash-latest";

const STRUCTURAL_HTML_SELECTORS: [&str; 11] = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "dt",
    "dd",
];

#[derive(Debug, Clone)]
struct ManifestItem {
    href: String,
    media_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedChapter {
    id: String,
    title: String,
    content: String,
}

/// Abre o seletor nativo do sistema operacional.
#[tauri::command]
async fn selecionar_epub(app: AppHandle) -> Result<String, String> {
    let selected_file = app
        .dialog()
        .file()
        .add_filter("Ebooks EPUB", &["epub"])
        .blocking_pick_file();

    selected_file
        .map(|path| path.to_string())
        .ok_or_else(|| "Nenhum arquivo selecionado".to_string())
}

/// Retorna o diretório usado para os arquivos de cache.
fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível localizar AppData: {error}"))?
        .join("cache");

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Não foi possível criar o diretório de cache: {error}"))?;

    Ok(directory)
}

/// Impede que a chave recebida forme caminhos arbitrários.
fn sanitize_cache_key(key: &str) -> Result<String, String> {
    let sanitized: String = key
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
            {
                character
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        return Err("A chave do cache é inválida".to_string());
    }

    Ok(sanitized)
}

fn cache_file_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let safe_key = sanitize_cache_key(key)?;
    Ok(cache_directory(app)?.join(format!("{safe_key}.json")))
}

/// Carrega um cache persistente.
///
/// `key_nome` no Rust corresponde a `keyNome` no frontend.
#[tauri::command]
async fn carregar_progresso_cache(
    app: AppHandle,
    key_nome: String,
) -> Result<Option<Value>, String> {
    let path = cache_file_path(&app, &key_nome)?;

    if !path.exists() {
        println!("Nenhum cache encontrado em: {}", path.display());
        return Ok(None);
    }

    let raw_json = fs::read_to_string(&path)
        .map_err(|error| format!("Não foi possível ler o cache: {error}"))?;

    let payload: Value = serde_json::from_str(&raw_json)
        .map_err(|error| format!("O cache contém JSON inválido: {error}"))?;

    println!("Cache carregado de: {}", path.display());

    Ok(Some(payload))
}

/// Salva o cache usando escrita temporária antes da substituição.
///
/// `key_nome` corresponde a `keyNome`.
#[tauri::command]
async fn salvar_progresso_cache(
    app: AppHandle,
    key_nome: String,
    payload: Value,
) -> Result<(), String> {
    let destination = cache_file_path(&app, &key_nome)?;
    let temporary = destination.with_extension("json.tmp");

    let formatted_json = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("Não foi possível serializar o cache: {error}"))?;

    {
        let mut temporary_file = File::create(&temporary)
            .map_err(|error| format!("Não foi possível criar o cache temporário: {error}"))?;

        temporary_file
            .write_all(&formatted_json)
            .map_err(|error| format!("Não foi possível escrever o cache temporário: {error}"))?;

        temporary_file
            .sync_all()
            .map_err(|error| format!("Não foi possível sincronizar o cache: {error}"))?;
    }

    // No Windows, renomear sobre um arquivo existente pode falhar.
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Não foi possível substituir o cache anterior: {error}"))?;
    }

    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Não foi possível concluir o salvamento do cache: {error}"))?;

    println!("Cache salvo em: {}", destination.display());

    Ok(())
}

/// Lê um arquivo textual dentro do ZIP.
fn read_zip_text(
    archive: &mut ZipArchive<File>,
    resource_path: &str,
) -> Result<String, String> {
    let decoded_path = percent_decode_str(resource_path)
        .decode_utf8_lossy()
        .replace('\\', "/");

    let mut file = archive
        .by_name(&decoded_path)
        .map_err(|error| {
            format!(
                "Não foi possível abrir o recurso '{decoded_path}' dentro do EPUB: {error}"
            )
        })?;

    let mut bytes = Vec::new();

    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Não foi possível ler '{decoded_path}': {error}"))?;

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Normaliza caminhos internos sem permitir que `..` escape da raiz lógica.
fn normalize_epub_path(path: &Path) -> String {
    let mut normalized_components: Vec<String> = Vec::new();

    for component in path.components() {
        match component {
            Component::Normal(value) => {
                normalized_components.push(value.to_string_lossy().into_owned());
            }
            Component::ParentDir => {
                normalized_components.pop();
            }
            Component::CurDir | Component::RootDir | Component::Prefix(_) => {}
        }
    }

    normalized_components.join("/")
}

fn resolve_epub_resource(opf_path: &str, href: &str) -> String {
    let opf_directory = Path::new(opf_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));

    normalize_epub_path(&opf_directory.join(href))
}

fn extract_document_title(html: &str, fallback: &str) -> String {
    let document = Html::parse_document(html);

    for selector_text in ["title", "h1", "h2"] {
        let Ok(selector) = Selector::parse(selector_text) else {
            continue;
        };

        if let Some(element) = document.select(&selector).next() {
            let title = element
                .text()
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");

            if !title.is_empty() {
                return title;
            }
        }
    }

    Path::new(fallback)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Capítulo")
        .replace(['_', '-'], " ")
}

/// Extrai capítulos na ordem oficial do spine do EPUB.
///
/// O comando preserva o HTML/XHTML integral de cada documento.
#[tauri::command]
async fn extract_epub_chapters(
    path: String,
) -> Result<Vec<ExtractedChapter>, String> {
    let epub_file = File::open(&path)
        .map_err(|error| format!("Não foi possível abrir o EPUB '{path}': {error}"))?;

    let mut archive = ZipArchive::new(epub_file)
        .map_err(|error| format!("O arquivo selecionado não é um EPUB/ZIP válido: {error}"))?;

    let container_xml = read_zip_text(
        &mut archive,
        "META-INF/container.xml",
    )?;

    let container_document = Document::parse(&container_xml)
        .map_err(|error| format!("container.xml inválido: {error}"))?;

    let opf_path = container_document
        .descendants()
        .find(|node| node.has_tag_name("rootfile"))
        .and_then(|node| node.attribute("full-path"))
        .ok_or_else(|| {
            "O EPUB não informa o arquivo OPF em META-INF/container.xml".to_string()
        })?
        .to_string();

    let opf_xml = read_zip_text(&mut archive, &opf_path)?;

    let opf_document = Document::parse(&opf_xml)
        .map_err(|error| format!("Arquivo OPF inválido: {error}"))?;

    let mut manifest: HashMap<String, ManifestItem> = HashMap::new();

    for item in opf_document
        .descendants()
        .filter(|node| node.has_tag_name("item"))
    {
        let Some(id) = item.attribute("id") else {
            continue;
        };

        let Some(href) = item.attribute("href") else {
            continue;
        };

        let media_type = item
            .attribute("media-type")
            .unwrap_or_default()
            .to_string();

        manifest.insert(
            id.to_string(),
            ManifestItem {
                href: href.to_string(),
                media_type,
            },
        );
    }

    let spine_ids: Vec<String> = opf_document
        .descendants()
        .filter(|node| node.has_tag_name("itemref"))
        .filter_map(|node| node.attribute("idref"))
        .map(ToOwned::to_owned)
        .collect();

    if spine_ids.is_empty() {
        return Err("O EPUB não possui documentos no spine".to_string());
    }

    let mut chapters = Vec::new();

    for (index, idref) in spine_ids.iter().enumerate() {
        let Some(item) = manifest.get(idref) else {
            continue;
        };

        let is_document = matches!(
            item.media_type.as_str(),
            "application/xhtml+xml" | "text/html"
        );

        if !is_document {
            continue;
        }

        let internal_path = resolve_epub_resource(
            &opf_path,
            &item.href,
        );

        let content = match read_zip_text(&mut archive, &internal_path) {
            Ok(content) => content,
            Err(error) => {
                eprintln!("Ignorando recurso ilegível '{internal_path}': {error}");
                continue;
            }
        };

        if content.trim().is_empty() {
            continue;
        }

        let title = extract_document_title(
            &content,
            &item.href,
        );

        chapters.push(ExtractedChapter {
            id: internal_path,
            title: if title.trim().is_empty() {
                format!("Capítulo {}", index + 1)
            } else {
                title
            },
            content,
        });
    }

    if chapters.is_empty() {
        return Err(
            "Nenhum capítulo HTML/XHTML legível foi encontrado no spine do EPUB"
                .to_string(),
        );
    }

    println!(
        "{} capítulos extraídos de: {}",
        chapters.len(),
        path
    );

    Ok(chapters)
}

fn translation_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 Chrome/133 Safari/537.36",
        )
        .build()
        .map_err(|error| format!("Não foi possível criar o cliente HTTP: {error}"))
}

fn parse_google_free_response(payload: &Value) -> Option<String> {
    if let Some(sentences) = payload
        .get("sentences")
        .and_then(Value::as_array)
    {
        let translation = sentences
            .iter()
            .filter_map(|sentence| {
                sentence
                    .get("trans")
                    .and_then(Value::as_str)
            })
            .collect::<String>();

        if !translation.trim().is_empty() {
            return Some(translation);
        }
    }

    // Compatibilidade com a resposta em arrays usada por algumas variantes.
    if let Some(groups) = payload.as_array() {
        let mut translated = String::new();

        if let Some(sentences) = groups.first().and_then(Value::as_array) {
            for sentence in sentences {
                if let Some(text) = sentence
                    .as_array()
                    .and_then(|values| values.first())
                    .and_then(Value::as_str)
                {
                    translated.push_str(text);
                }
            }
        }

        if !translated.trim().is_empty() {
            return Some(translated);
        }
    }

    None
}

/// Traduz um bloco usando o endpoint GTX.
///
/// `target_lang` corresponde a `targetLang`.
#[tauri::command]
async fn translate_text_free(
    text: String,
    target_lang: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(text);
    }

    if target_lang.trim().is_empty() {
        return Err("O idioma de destino não foi informado".to_string());
    }

    let client = translation_http_client()?;
    let mut last_error = "Resposta vazia do serviço de tradução".to_string();

    for attempt in 1_u64..=3 {
        let response = client
            .get(GOOGLE_FREE_ENDPOINT)
            .query(&[
                ("client", "gtx"),
                ("sl", "auto"),
                ("tl", target_lang.as_str()),
                ("dt", "t"),
                ("dj", "1"),
                ("q", text.as_str()),
            ])
            .send()
            .await;

        match response {
            Ok(response) => {
                let status = response.status();

                if !status.is_success() {
                    last_error = format!(
                        "Google Free respondeu com HTTP {status}"
                    );
                } else {
                    match response.json::<Value>().await {
                        Ok(payload) => {
                            if let Some(translation) =
                                parse_google_free_response(&payload)
                            {
                                return Ok(translation);
                            }

                            last_error =
                                "Google Free retornou uma resposta sem tradução"
                                    .to_string();
                        }
                        Err(error) => {
                            last_error = format!(
                                "Resposta inválida do Google Free: {error}"
                            );
                        }
                    }
                }
            }
            Err(error) => {
                last_error =
                    format!("Falha ao acessar o Google Free: {error}");
            }
        }

        if attempt < 3 {
            sleep(Duration::from_millis(attempt * 800)).await;
        }
    }

    Err(last_error)
}

fn target_language_name(code: &str) -> &str {
    match code {
        "eo" => "Esperanto",
        "pt" | "pt-BR" => "Português",
        "en" => "English",
        "es" => "Español",
        "fr" => "Français",
        "de" => "Deutsch",
        "ru" => "Русский",
        "zh" | "zh-CN" => "中文",
        "ar" => "العربية",
        _ => code,
    }
}

fn clean_gemini_output(value: &str) -> String {
    let trimmed = value.trim();

    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let without_opening = trimmed
            .strip_prefix("```html")
            .or_else(|| trimmed.strip_prefix("```xml"))
            .or_else(|| trimmed.strip_prefix("```"))
            .unwrap_or(trimmed);

        return without_opening
            .strip_suffix("```")
            .unwrap_or(without_opening)
            .trim()
            .to_string();
    }

    trimmed.to_string()
}

fn extract_gemini_text(payload: &Value) -> Option<String> {
    let parts = payload
        .get("candidates")?
        .as_array()?
        .first()?
        .get("content")?
        .get("parts")?
        .as_array()?;

    let combined = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<String>();

    if combined.trim().is_empty() {
        None
    } else {
        Some(clean_gemini_output(&combined))
    }
}

/// Traduz um bloco por meio da API Gemini.
///
/// A chave é recebida somente em memória e não é salva no cache.
///
/// `target_lang` corresponde a `targetLang`.
#[tauri::command]
async fn translate_text_gemini(
    text: String,
    target_lang: String,
    key: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(text);
    }

    if key.trim().is_empty() {
        return Err("A chave da API Gemini não foi informada".to_string());
    }

    if target_lang.trim().is_empty() {
        return Err("O idioma de destino não foi informado".to_string());
    }

    let target_language = target_language_name(&target_lang);

    let prompt = format!(
        "Você é um tradutor profissional.\n\
         Traduza o conteúdo a seguir para {target_language}.\n\
         Preserve integralmente qualquer estrutura HTML.\n\
         Não traduza nomes de tags, atributos, classes, IDs, URLs ou caminhos.\n\
         Não acrescente explicações, observações ou Markdown.\n\
         Retorne somente o conteúdo traduzido.\n\n\
         CONTEÚDO:\n{text}"
    );

    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/\
         {GEMINI_MODEL}:generateContent"
    );

    let request_payload = json!({
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2
        }
    });

    let client = translation_http_client()?;
    let mut last_error = "Resposta vazia da API Gemini".to_string();

    for attempt in 1_u64..=3 {
        let response = client
            .post(&endpoint)
            .query(&[("key", key.as_str())])
            .json(&request_payload)
            .send()
            .await;

        match response {
            Ok(response) => {
                let status = response.status();

                let response_body = response
                    .json::<Value>()
                    .await
                    .map_err(|error| {
                        format!(
                            "A API Gemini retornou uma resposta inválida: {error}"
                        )
                    })?;

                if status.is_success() {
                    if let Some(translation) =
                        extract_gemini_text(&response_body)
                    {
                        return Ok(translation);
                    }

                    last_error =
                        "A API Gemini não retornou texto traduzido".to_string();
                } else {
                    let api_message = response_body
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Erro não especificado");

                    last_error = format!(
                        "Gemini respondeu com HTTP {status}: {api_message}"
                    );

                    // Erros de autenticação e requisição não melhoram com repetição.
                    if status.as_u16() == 400
                        || status.as_u16() == 401
                        || status.as_u16() == 403
                    {
                        return Err(last_error);
                    }
                }
            }
            Err(error) => {
                last_error =
                    format!("Falha ao acessar a API Gemini: {error}");
            }
        }

        if attempt < 3 {
            sleep(Duration::from_millis(attempt * 1_000)).await;
        }
    }

    Err(last_error)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            selecionar_epub,
            carregar_progresso_cache,
            salvar_progresso_cache,
            extract_epub_chapters,
            translate_text_free,
            translate_text_gemini,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar a aplicação Tauri");
}