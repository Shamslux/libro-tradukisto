// src-tauri/src/lib.rs

use percent_encoding::percent_decode_str;
use reqwest::Client;
use roxmltree::Document;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
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
use zip::{write::FileOptions, CompressionMethod, ZipArchive, ZipWriter};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslatedChapterPayload {
    internal_path: String,
    content: String,
}

/// Dynamic payload container designed to route translation requests to different providers safely.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslationRequest {
    text: String,
    target_lang: String,
    provider: String, // "local" | "openai" | "claude" | "gemini"
    model: String,
    api_key: Option<String>,
    base_url_override: Option<String>,
}

/// Opens the native operating system file picker to select an EPUB book.
#[tauri::command]
async fn selecionar_epub(app: AppHandle) -> Result<String, String> {
    let selected_file = app
        .dialog()
        .file()
        .add_filter("Ebooks EPUB", &["epub"])
        .blocking_pick_file();

    selected_file
        .map(|path| path.to_string())
        .ok_or_else(|| "No file selected".to_string())
}

/// Locates and initializes the local cache folder within the AppData workspace directory.
fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate AppData directory: {error}"))?
        .join("cache");

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create cache directory: {error}"))?;

    Ok(directory)
}

/// Sanitizes the cache identifier string to block directory-traversal attempts.
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
        return Err("The cache key is invalid".to_string());
    }

    Ok(sanitized)
}

/// Computes the exact file path for a specific cached document project.
fn cache_file_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let safe_key = sanitize_cache_key(key)?;
    Ok(cache_directory(app)?.join(format!("{safe_key}.json")))
}

/// Reads a saved translation session from the local cache storage.
#[tauri::command]
async fn carregar_progresso_cache(
    app: AppHandle,
    key_nome: String,
) -> Result<Option<Value>, String> {
    let path = cache_file_path(&app, &key_nome)?;

    if !path.exists() {
        println!("No translation cache found at: {}", path.display());
        return Ok(None);
    }

    let raw_json = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the cache file: {error}"))?;

    let payload: Value = serde_json::from_str(&raw_json)
        .map_err(|error| format!("The cache contains invalid JSON formatting: {error}"))?;

    println!("Cache successfully retrieved from: {}", path.display());

    Ok(Some(payload))
}

/// Saves translation progress atomically utilizing a temporary file swap to prevent data corruption.
#[tauri::command]
async fn salvar_progresso_cache(
    app: AppHandle,
    key_nome: String,
    payload: Value,
) -> Result<(), String> {
    let destination = cache_file_path(&app, &key_nome)?;
    let temporary = destination.with_extension("json.tmp");

    let formatted_json = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("Failed to serialize translation cache: {error}"))?;

    {
        let mut temporary_file = File::create(&temporary)
            .map_err(|error| format!("Could not write to temporary cache: {error}"))?;

        temporary_file
            .write_all(&formatted_json)
            .map_err(|error| format!("Failed writing contents to cache buffer: {error}"))?;

        temporary_file
            .sync_all()
            .map_err(|error| format!("Failed syncing the cache file to disk: {error}"))?;
    }

    // Windows filesystem lock handling: Remove the stale destination manually if it exists
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Could not clear the previous cache index: {error}"))?;
    }

    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Failed to complete atomic cache transition swap: {error}"))?;

    println!("Cache safely persisted to disk at: {}", destination.display());

    Ok(())
}

/// Extracts raw bytes from a target document zipped inside the EPUB archive.
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
                "Could not locate internal resource '{decoded_path}' inside the EPUB structure: {error}"
            )
        })?;

    let mut bytes = Vec::new();

    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to extract the stream bytes from '{decoded_path}': {error}"))?;

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Normalizes internal folder structures safely while blocking parent directory jumps.
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

/// Resolves a path containing relative references inside the OPF metadata workspace directory.
fn resolve_epub_resource(opf_path: &str, href: &str) -> String {
    let opf_directory = Path::new(opf_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));

    normalize_epub_path(&opf_directory.join(href))
}

/// Searches the header layout structure of a chapter's HTML to locate a descriptive title.
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
        .unwrap_or("Chapter")
        .replace(['_', '-'], " ")
}

/// Scans the selected EPUB file and parses XHTML/HTML chapters according to the OPF spine ordering.
#[tauri::command]
async fn extract_epub_chapters(
    path: String,
) -> Result<Vec<ExtractedChapter>, String> {
    let epub_file = File::open(&path)
        .map_err(|error| format!("Could not open EPUB file at target '{path}': {error}"))?;

    let mut archive = ZipArchive::new(epub_file)
        .map_err(|error| format!("The selected file is not a valid EPUB/ZIP archive: {error}"))?;

    let container_xml = read_zip_text(
        &mut archive,
        "META-INF/container.xml",
    )?;

    let container_document = Document::parse(&container_xml)
        .map_err(|error| format!("Failed parsing structural container.xml: {error}"))?;

    let opf_path = container_document
        .descendants()
        .find(|node| node.has_tag_name("rootfile"))
        .and_then(|node| node.attribute("full-path"))
        .ok_or_else(|| {
            "The EPUB container does not declare a rootfile OPF index".to_string()
        })?
        .to_string();

    let opf_xml = read_zip_text(&mut archive, &opf_path)?;

    let opf_document = Document::parse(&opf_xml)
        .map_err(|error| format!("Failed parsing root OPF document: {error}"))?;

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
        return Err("The target EPUB has no readable spine items".to_string());
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
                eprintln!("Skipping unreadable structural asset '{internal_path}': {error}");
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
                format!("Chapter {}", index + 1)
            } else {
                title
            },
            content,
        });
    }

    if chapters.is_empty() {
        return Err(
            "No readable HTML/XHTML chapters found within the EPUB spine".to_string(),
        );
    }

    println!(
        "{} chapters successfully extracted from target: {}",
        chapters.len(),
        path
    );

    Ok(chapters)
}

/// Builds a client instance to execute HTTP requests with custom timeouts and user-agents.
fn translation_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 Chrome/133 Safari/537.36",
        )
        .build()
        .map_err(|error| format!("Failed to initialize HTTP translation client: {error}"))
}

/// Parses arrays or standard dictionary structures returned by Google Translate's single API.
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

/// Translates a localized text block using Google's free translation portal (GTX).
#[tauri::command]
async fn translate_text_free(
    text: String,
    target_lang: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(text);
    }

    if target_lang.trim().is_empty() {
        return Err("The destination target language is missing".to_string());
    }

    let client = translation_http_client()?;
    let mut last_error = "Empty response returned from Google Free portal".to_string();

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
                        "Google Free service returned HTTP status {status}"
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
                                "Google Free responded without a valid translation string"
                                    .to_string();
                        }
                        Err(error) => {
                            last_error = format!(
                                "Invalid JSON response payload from Google Free: {error}"
                            );
                        }
                    }
                }
            }
            Err(error) => {
                last_error =
                    format!("Failed to establish connection with Google Free: {error}");
            }
        }

        if attempt < 3 {
            sleep(Duration::from_millis(attempt * 800)).await;
        }
    }

    Err(last_error)
}

/// Maps a language ISO code to its readable localized native name descriptor.
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

/// Strips markdown block indicators and extracts raw code strings cleanly.
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

/// Extracts translated content from a Gemini API completion payload.
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

/// Translates a specific segment using Google's Gemini Flash engine.
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
        return Err("The Gemini API Key is missing".to_string());
    }

    if target_lang.trim().is_empty() {
        return Err("The destination target language is missing".to_string());
    }

    let target_language = target_language_name(&target_lang);

    let prompt = format!(
        "You are a professional translator.\n\
         Translate the following content into {target_language}.\n\
         Completely preserve any HTML structure.\n\
         Do not translate tag names, attributes, classes, IDs, URLs, or file paths.\n\
         Do not append any explanations, side notes, or Markdown formatting.\n\
         Return only the translated content.\n\n\
         CONTENT:\n{text}"
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
    let mut last_error = "Empty response returned from the Gemini API gateway".to_string();

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
                            "Gemini API returned an unparseable response structure: {error}"
                        )
                    })?;

                if status.is_success() {
                    if let Some(translation) =
                        extract_gemini_text(&response_body)
                    {
                        return Ok(translation);
                    }

                    last_error =
                        "The Gemini API responded successfully but did not return any content text".to_string();
                } else {
                    let api_message = response_body
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unspecified API error");

                    last_error = format!(
                        "Gemini gateway responded with status {status}: {api_message}"
                    );

                    // Halt execution retries if an authorization issue is raised
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
                    format!("Failed to reach the Gemini API endpoint: {error}");
            }
        }

        if attempt < 3 {
            sleep(Duration::from_millis(attempt * 1_000)).await;
        }
    }

    Err(last_error)
}

/// Security-hardened command handler to dispatch translations across local and cloud providers.
/// Keeps API credentials purely in transient memory with automated request sanitization.
#[tauri::command]
async fn translate_text_ai(req: TranslationRequest) -> Result<String, String> {
    if req.text.trim().is_empty() {
        return Ok(req.text);
    }

    let target_language = target_language_name(&req.target_lang);

    // Standard instruction template for structural HTML preservation across translation engines
    let prompt = format!(
        "You are a professional translator.\n\
         Translate the following content into {target_language}.\n\
         Completely preserve any HTML structure.\n\
         Do not translate tag names, attributes, classes, IDs, URLs, or file paths.\n\
         Do not append any explanations, side notes, or Markdown formatting.\n\
         Return only the translated content.\n\n\
         CONTENT:\n{}",
        req.text
    );

    let client = translation_http_client()?;

    match req.provider.as_str() {
        "local" | "openai" | "claude" => {
            let is_local = req.provider == "local";
            let is_claude = req.provider == "claude";
            
            // Set default targets based on the chosen translation provider
            let default_url = if is_claude {
                "https://api.anthropic.com/v1/messages".to_string()
            } else {
                "https://api.openai.com/v1/chat/completions".to_string()
            };
            
            let mut endpoint = req.base_url_override.unwrap_or(default_url);
            
            // Auto-append chat API parameters for local interfaces if neglected by the user
            if is_local && !endpoint.ends_with("/chat/completions") {
                if endpoint.ends_with('/') {
                    endpoint.push_str("chat/completions");
                } else {
                    endpoint.push_str("/chat/completions");
                }
            }

            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::CONTENT_TYPE,
                reqwest::header::HeaderValue::from_static("application/json"),
            );

            // Safely inject API key headers only if credentials are provided
            if let Some(ref key) = req.api_key {
                if !key.trim().is_empty() {
                    let mut auth_val = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
                        .map_err(|_| "Failed to format Authorization header string".to_string())?;
                    
                    if is_claude {
                        auth_val = reqwest::header::HeaderValue::from_str(key)
                            .map_err(|_| "Failed to format Anthropic key header".to_string())?;
                        headers.insert(
                            reqwest::header::HeaderName::from_static("x-api-key"),
                            auth_val.clone(),
                        );
                        headers.insert(
                            reqwest::header::HeaderName::from_static("anthropic-version"),
                            reqwest::header::HeaderValue::from_static("2023-06-01"),
                        );
                    } else {
                        auth_val.set_sensitive(true);
                        headers.insert(reqwest::header::AUTHORIZATION, auth_val);
                    }
                }
            } else if !is_local {
                return Err(format!("An API Key is required to utilize the {} service", req.provider));
            }

            // Create provider-specific request payload schemas
            let body = if is_claude {
                json!({
                    "model": req.model,
                    "max_tokens": 4096,
                    "system": "Translate exactly as requested without explanations.",
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "temperature": 0.2
                })
            } else {
                json!({
                    "model": req.model,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "temperature": 0.2
                })
            };

            // Process HTTP network calls while protecting key strings from leakage in system logs
            let response = client
                .post(&endpoint)
                .headers(headers)
                .json(&body)
                .send()
                .await
                .map_err(|err| {
                    let err_string = err.to_string();
                    let key_str = req.api_key.clone().unwrap_or_default();
                    format!(
                        "Network communication with translation service failed: {}",
                        if !key_str.is_empty() { err_string.replace(&key_str, "***") } else { err_string }
                    )
                })?;

            let status = response.status();
            let res_json: Value = response.json().await.map_err(|err| {
                format!("Failed parsing the service's returned payload: {err}")
            })?;

            if status.is_success() {
                let translated = if is_claude {
                    res_json
                        .get("content")
                        .and_then(|c| c.as_array())
                        .and_then(|a| a.first())
                        .and_then(|first| first.get("text"))
                        .and_then(|text| text.as_str())
                        .ok_or_else(|| "Unexpected Claude API JSON response structure".to_string())?
                } else {
                    res_json
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|a| a.first())
                        .and_then(|first| first.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|content| content.as_str())
                        .ok_or_else(|| "Unexpected OpenAI API JSON response structure".to_string())?
                };
                
                Ok(clean_gemini_output(translated))
            } else {
                let err_msg = res_json
                    .get("error")
                    .and_then(|err| err.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("An unspecified server error was raised");
                
                let key_str = req.api_key.unwrap_or_default();
                let sanitized_err = if !key_str.is_empty() { err_msg.replace(&key_str, "***") } else { err_msg.to_string() };
                
                Err(format!("The translation service returned error {status}: {sanitized_err}"))
            }
        }
        "gemini" => {
            let key = req.api_key.ok_or_else(|| "Gemini API key is missing".to_string())?;
            if key.trim().is_empty() {
                return Err("Gemini API key is empty".to_string());
            }
            translate_text_gemini(req.text, req.target_lang, key).await
        }
        _ => Err(format!("The requested translation provider '{}' is not supported.", req.provider)),
    }
}

/// Rebuilds the EPUB package, overlaying translated chapters while leaving original formatting intact.
/// Inserts the uncompressed `mimetype` file first to guarantee validation compliance.
#[tauri::command]
async fn gerar_epub(
    original_epub_path: String,
    output_epub_path: String,
    translated_chapters: Vec<TranslatedChapterPayload>,
) -> Result<(), String> {
    let original_file = File::open(&original_epub_path)
        .map_err(|e| format!("Could not open the source EPUB archive: {e}"))?;
    
    let mut original_archive = ZipArchive::new(original_file)
        .map_err(|e| format!("The original ebook is not a valid ZIP structure: {e}"))?;

    let output_file = File::create(&output_epub_path)
        .map_err(|e| format!("Could not initialize the target output file: {e}"))?;
    
    let mut writer = ZipWriter::new(output_file);

    let translated_map: HashMap<String, String> = translated_chapters
        .into_iter()
        .map(|ch| (ch.internal_path, ch.content))
        .collect();

    // 1. Force uncompressed mimetype write operation as index 0 for EPUB format validation compliance
    let mut mimetype_buffer = Vec::new();
    if let Ok(mut mimetype_file) = original_archive.by_name("mimetype") {
        mimetype_file
            .read_to_end(&mut mimetype_buffer)
            .map_err(|e| format!("Failed to read source mimetype stream: {e}"))?;
    } else {
        mimetype_buffer = b"application/epub+zip".to_vec();
    }

    let mimetype_options = FileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o644);

    writer
        .start_file("mimetype", mimetype_options)
        .map_err(|e| format!("Failed initializing mimetype index in output archive: {e}"))?;
    
    writer
        .write_all(&mimetype_buffer)
        .map_err(|e| format!("Failed writing mimetype string into output: {e}"))?;

    // 2. Clone styling, metadata and image assets while substituting the translated HTML documents
    for i in 0..original_archive.len() {
        let mut file = original_archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive contents at index {i}: {e}"))?;
        
        let name = file.name().to_string();

        if name == "mimetype" {
            continue;
        }

        let options = FileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        writer
            .start_file(name.clone(), options)
            .map_err(|e| format!("Failed to prepare file index '{name}' in destination archive: {e}"))?;

        if let Some(translated_html) = translated_map.get(&name) {
            writer
                .write_all(translated_html.as_bytes())
                .map_err(|e| format!("Failed writing translated markup content for '{name}': {e}"))?;
        } else {
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed reading original asset source '{name}': {e}"))?;
            
            writer
                .write_all(&buffer)
                .map_err(|e| format!("Failed cloning original asset metadata '{name}' to output: {e}"))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to complete ZIP writing operations: {e}"))?;

    println!("Translated EPUB compiled successfully: {}", output_epub_path);
    Ok(())
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
            translate_text_ai,
            gerar_epub,
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while launching the Tauri application workspace");
}