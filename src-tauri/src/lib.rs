// src-tauri/src/lib.rs

use percent_encoding::percent_decode_str;

use reqwest::Client;

use roxmltree::Document;

use scraper::{Html, Selector};

use serde::{Deserialize, Serialize};

use serde_json::{json, Value};

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use tauri::{AppHandle, Manager};

use tauri_plugin_dialog::DialogExt;

use tokio::time::sleep;

use zip::{write::FileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

use std::sync::{Mutex, OnceLock};

const GOOGLE_FREE_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";

const GEMINI_MODEL: &str = "gemini-flash-latest";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]

struct CacheMetadata {
    key: String,

    epub_path: String,

    target_language: String,

    engine: String,

    total_chapters: usize,
}

/// Opens the native operating system file picker to select an EPUB book.

#[tauri::command]

async fn select_epub(app: AppHandle) -> Result<String, String> {
    let selected_file = app
        .dialog()
        .file()
        .add_filter("EPUB Ebooks", &["epub"])
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
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
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

async fn load_progress_cache(app: AppHandle, key_name: String) -> Result<Option<Value>, String> {
    let path = cache_file_path(&app, &key_name)?;

    let _guard = cache_operation_lock()
        .lock()
        .map_err(|_| "Cache operation lock was poisoned".to_string())?;

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

// Serializes cache operations within this process, including deletion and reads.

fn cache_operation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(windows)]

fn replace_existing_cache(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::{ffi::c_void, iter::once};

    #[link(name = "Kernel32")]

    extern "system" {

        fn ReplaceFileW(
            replaced_file_name: *const u16,

            replacement_file_name: *const u16,

            backup_file_name: *const u16,

            replace_flags: u32,

            exclude: *mut c_void,

            reserved: *mut c_void,
        ) -> i32;

    }

    let old: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect();

    let new: Vec<u16> = temporary.as_os_str().encode_wide().chain(once(0)).collect();

    let result = unsafe {
        ReplaceFileW(
            old.as_ptr(),
            new.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };

    if result == 0 {
        return Err(format!(
            "Could not replace existing cache: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
}

/// Writes the new cache to a synced temporary file before replacing the old one.

#[tauri::command]

async fn save_progress_cache(
    app: AppHandle,

    key_name: String,

    payload: Value,
) -> Result<(), String> {
    let destination = cache_file_path(&app, &key_name)?;

    let formatted_json = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("Failed to serialize translation cache: {error}"))?;

    let _guard = cache_operation_lock()
        .lock()
        .map_err(|_| "Cache operation lock was poisoned".to_string())?;

    // create_new avoids silently truncating a temporary file left by another process.

    // The mutex serializes writes from this process; a process-specific name reduces

    // collisions with other application instances.

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Could not create cache timestamp: {error}"))?
        .as_nanos();

    let temporary =
        destination.with_extension(format!("{}.{}.json.tmp", std::process::id(), nonce));

    let write_result = (|| -> Result<(), String> {
        let mut file = File::create_new(&temporary)
            .map_err(|error| format!("Could not create temporary cache: {error}"))?;

        file.write_all(&formatted_json)
            .map_err(|error| format!("Could not write temporary cache: {error}"))?;

        file.sync_all()
            .map_err(|error| format!("Could not sync temporary cache: {error}"))?;

        drop(file);

        #[cfg(windows)]
        {
            if destination.exists() {
                replace_existing_cache(&temporary, &destination)?;
            } else {
                fs::rename(&temporary, &destination)
                    .map_err(|error| format!("Could not create cache file: {error}"))?;
            }
        }

        #[cfg(not(windows))]
        {
            fs::rename(&temporary, &destination)
                .map_err(|error| format!("Could not replace cache file: {error}"))?;
        }

        Ok(())
    })();

    if write_result.is_err() {
        // Never remove the destination on failure. Only clean up our temp file.

        let _ = fs::remove_file(&temporary);
    }

    write_result?;

    println!("Cache persisted to disk at: {}", destination.display());

    Ok(())
}

/// Extracts raw bytes from a target document zipped inside the EPUB archive.

fn read_zip_text(archive: &mut ZipArchive<File>, resource_path: &str) -> Result<String, String> {
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

    file.read_to_end(&mut bytes).map_err(|error| {
        format!("Failed to extract the stream bytes from '{decoded_path}': {error}")
    })?;

    String::from_utf8(bytes).map_err(|error| format!("EPUB text resource is not UTF-8: {error}"))
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

async fn extract_epub_chapters(path: String) -> Result<Vec<ExtractedChapter>, String> {
    let epub_file = File::open(&path)
        .map_err(|error| format!("Could not open EPUB file at target '{path}': {error}"))?;

    let mut archive = ZipArchive::new(epub_file)
        .map_err(|error| format!("The selected file is not a valid EPUB/ZIP archive: {error}"))?;

    let container_xml = read_zip_text(&mut archive, "META-INF/container.xml")?;

    let container_document = Document::parse(&container_xml)
        .map_err(|error| format!("Failed parsing structural container.xml: {error}"))?;

    let opf_path = container_document
        .descendants()
        .find(|node| node.has_tag_name("rootfile"))
        .and_then(|node| node.attribute("full-path"))
        .ok_or_else(|| "The EPUB container does not declare a rootfile OPF index".to_string())?
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

        let media_type = item.attribute("media-type").unwrap_or_default().to_string();

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

        let internal_path = resolve_epub_resource(&opf_path, &item.href);

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

        let title = extract_document_title(&content, &item.href);

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
        return Err("No readable HTML/XHTML chapters found within the EPUB spine".to_string());
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
    if let Some(sentences) = payload.get("sentences").and_then(Value::as_array) {
        let translation = sentences
            .iter()
            .filter_map(|sentence| sentence.get("trans").and_then(Value::as_str))
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

async fn translate_text_free(text: String, target_lang: String) -> Result<String, String> {
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
                    last_error = format!("Google Free service returned HTTP status {status}");
                } else {
                    match response.json::<Value>().await {
                        Ok(payload) => {
                            if let Some(translation) = parse_google_free_response(&payload) {
                                return Ok(translation);
                            }

                            last_error = "Google Free responded without a valid translation string"
                                .to_string();
                        }

                        Err(error) => {
                            last_error =
                                format!("Invalid JSON response payload from Google Free: {error}");
                        }
                    }
                }
            }

            Err(error) => {
                last_error = format!("Failed to establish connection with Google Free: {error}");
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

                let response_body = response.json::<Value>().await.map_err(|error| {
                    format!("Gemini API returned an unparseable response structure: {error}")
                })?;

                if status.is_success() {
                    if let Some(translation) = extract_gemini_text(&response_body) {
                        return Ok(translation);
                    }

                    last_error =
                        "The Gemini API responded successfully but did not return any content text"
                            .to_string();
                } else {
                    let api_message = response_body
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unspecified API error");

                    last_error =
                        format!("Gemini gateway responded with status {status}: {api_message}");

                    // Halt execution retries if an authorization issue is raised

                    if status.as_u16() == 400 || status.as_u16() == 401 || status.as_u16() == 403 {
                        return Err(last_error);
                    }
                }
            }

            Err(error) => {
                last_error = format!("Failed to reach the Gemini API endpoint: {error}");
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
                    let mut auth_val = reqwest::header::HeaderValue::from_str(&format!(
                        "Bearer {key}"
                    ))
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
                return Err(format!(
                    "An API Key is required to utilize the {} service",
                    req.provider
                ));
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
                        if !key_str.is_empty() {
                            err_string.replace(&key_str, "***")
                        } else {
                            err_string
                        }
                    )
                })?;

            let status = response.status();

            let res_json: Value = response
                .json()
                .await
                .map_err(|err| format!("Failed parsing the service's returned payload: {err}"))?;

            if status.is_success() {
                let translated = if is_claude {
                    res_json
                        .get("content")
                        .and_then(|c| c.as_array())
                        .and_then(|a| a.first())
                        .and_then(|first| first.get("text"))
                        .and_then(|text| text.as_str())
                        .ok_or_else(|| {
                            "Unexpected Claude API JSON response structure".to_string()
                        })?
                } else {
                    res_json
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|a| a.first())
                        .and_then(|first| first.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|content| content.as_str())
                        .ok_or_else(|| {
                            "Unexpected OpenAI API JSON response structure".to_string()
                        })?
                };

                Ok(clean_gemini_output(translated))
            } else {
                let err_msg = res_json
                    .get("error")
                    .and_then(|err| err.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("An unspecified server error was raised");

                let key_str = req.api_key.unwrap_or_default();

                let sanitized_err = if !key_str.is_empty() {
                    err_msg.replace(&key_str, "***")
                } else {
                    err_msg.to_string()
                };

                Err(format!(
                    "The translation service returned error {status}: {sanitized_err}"
                ))
            }
        }

        "gemini" => {
            let key = req
                .api_key
                .ok_or_else(|| "Gemini API key is missing".to_string())?;

            if key.trim().is_empty() {
                return Err("Gemini API key is empty".to_string());
            }

            translate_text_gemini(req.text, req.target_lang, key).await
        }

        _ => Err(format!(
            "The requested translation provider '{}' is not supported.",
            req.provider
        )),
    }
}

// Structured, ID-preserving contextual translation. Existing single-text commands
// remain available for compatibility with older frontends and cached projects.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SegmentTranslationRequest {
    target_lang: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url_override: Option<String>,
    segments: Vec<SegmentSource>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SegmentSource {
    id: String,
    text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentResult {
    id: String,
    translated_text: String,
}

#[derive(Debug, Serialize)]
struct SegmentTranslationResponse {
    translations: Vec<SegmentResult>,
}

fn validate_segment_sources(segments: &[SegmentSource]) -> Result<(), String> {
    if segments.is_empty() || segments.len() > 100 {
        return Err("A translation request must contain between 1 and 100 segments".into());
    }
    let mut ids = HashSet::new();
    let mut total_chars = 0usize;
    for segment in segments {
        if segment.id.trim().is_empty() || segment.text.trim().is_empty() {
            return Err("Translation segment IDs and source texts must not be empty".into());
        }
        if !ids.insert(segment.id.as_str()) {
            return Err(format!("Duplicate source segment ID: {}", segment.id));
        }
        total_chars = total_chars.saturating_add(segment.text.chars().count());
    }
    if total_chars > 25_000 {
        return Err("Translation request exceeds 25,000 source characters".into());
    }
    Ok(())
}

fn parse_segment_response(
    raw: &str,
    expected: &[SegmentSource],
) -> Result<SegmentTranslationResponse, String> {
    // Accept a JSON object only; no best-effort text splitting or positional mapping.
    let cleaned = clean_gemini_output(raw);
    let value: Value = serde_json::from_str(&cleaned)
        .map_err(|_| "Provider did not return valid structured translation JSON".to_string())?;
    let entries = value
        .get("translations")
        .and_then(Value::as_array)
        .ok_or_else(|| "Provider response must contain a translations array".to_string())?;
    if entries.len() != expected.len() {
        return Err(format!(
            "Provider returned {} translations; expected {}",
            entries.len(),
            expected.len()
        ));
    }
    let expected_ids: HashSet<&str> = expected.iter().map(|item| item.id.as_str()).collect();
    let mut found = HashSet::new();
    let mut translated_by_id = HashMap::new();
    for entry in entries {
        let item: SegmentResult = serde_json::from_value(entry.clone()).map_err(|_| {
            "Malformed translation entry: expected id and translatedText strings".to_string()
        })?;
        if !expected_ids.contains(item.id.as_str()) {
            return Err(format!("Unexpected translation segment ID: {}", item.id));
        }
        if !found.insert(item.id.clone()) {
            return Err(format!("Duplicate translated segment ID: {}", item.id));
        }
        if item.translated_text.trim().is_empty() {
            return Err(format!("Empty translation for segment: {}", item.id));
        }
        translated_by_id.insert(item.id, item.translated_text);
    }
    // Return in source order, independent of provider response ordering.
    let translations = expected
        .iter()
        .map(|source| SegmentResult {
            id: source.id.clone(),
            translated_text: translated_by_id
                .remove(&source.id)
                .expect("validated exact ID set"),
        })
        .collect();
    Ok(SegmentTranslationResponse { translations })
}

#[tauri::command]
async fn translate_segments(
    req: SegmentTranslationRequest,
) -> Result<SegmentTranslationResponse, String> {
    validate_segment_sources(&req.segments)?;
    if req.target_lang.trim().is_empty() {
        return Err("The destination target language is missing".into());
    }
    if req.provider == "google_free" {
        // Google Free has no structured-output contract. Translate each node
        // independently, retaining IDs; do not claim cross-node context.
        let mut translations = Vec::with_capacity(req.segments.len());
        for source in req.segments {
            let translated_text = translate_text_free(source.text, req.target_lang.clone()).await?;
            if translated_text.trim().is_empty() {
                return Err(format!("Empty translation for segment: {}", source.id));
            }
            translations.push(SegmentResult {
                id: source.id,
                translated_text,
            });
        }
        return Ok(SegmentTranslationResponse { translations });
    }
    let input = serde_json::to_string(&json!({"segments": &req.segments}))
        .map_err(|error| format!("Cannot encode segment request: {error}"))?;
    let instructions = format!(
        "Translate each text value into the target language, using the other segments as context. \
         Preserve every ID exactly. Return ONLY a JSON object of the form \
         {{\"translations\":[{{\"id\":\"original ID\",\"translatedText\":\"translation\"}}]}}. \
         Include exactly one entry for each input ID, no extra IDs, no Markdown, no HTML tags. \
         Preserve meaningful leading and trailing whitespace in each text value. \
         INPUT JSON: {input}"
    );
    let raw = translate_text_ai(TranslationRequest {
        text: instructions,
        target_lang: req.target_lang,
        provider: req.provider,
        model: req.model,
        api_key: req.api_key,
        base_url_override: req.base_url_override,
    })
    .await?;
    parse_segment_response(&raw, &req.segments)
}

/// Ensures that translation changes only character data, not the document tree.
/// Element names, namespaces, attributes, and child-node kinds must match.
fn validate_translated_xhtml(
    original: &str,
    translated: &str,
    resource: &str,
) -> Result<(), String> {
    let before = Document::parse(original)
        .map_err(|error| format!("Original XHTML '{resource}' is not well-formed XML: {error}"))?;
    let after = Document::parse(translated).map_err(|error| {
        format!("Translated XHTML '{resource}' is not well-formed XML: {error}")
    })?;

    if before.root_element().tag_name().name() != "html"
        || after.root_element().tag_name().name() != "html"
    {
        return Err(format!(
            "Resource '{resource}' must have an XHTML html root element"
        ));
    }

    let source_elements: Vec<_> = before
        .descendants()
        .filter(|node| node.is_element())
        .collect();
    let output_elements: Vec<_> = after
        .descendants()
        .filter(|node| node.is_element())
        .collect();
    if source_elements.len() != output_elements.len() {
        return Err(format!("XHTML element count changed in '{resource}'"));
    }

    for (source, output) in source_elements.iter().zip(output_elements.iter()) {
        if source.tag_name() != output.tag_name() {
            return Err(format!(
                "XHTML element name or namespace changed in '{resource}'"
            ));
        }
        let source_attributes: HashSet<_> = source
            .attributes()
            .map(|attribute| (attribute.namespace(), attribute.name(), attribute.value()))
            .collect();
        let output_attributes: HashSet<_> = output
            .attributes()
            .map(|attribute| (attribute.namespace(), attribute.name(), attribute.value()))
            .collect();
        if source_attributes != output_attributes {
            return Err(format!("XHTML attributes changed in '{resource}'"));
        }
        let source_children: Vec<_> = source
            .children()
            .filter(|node| node.is_element())
            .map(|node| (node.tag_name().namespace(), node.tag_name().name()))
            .collect();
        let output_children: Vec<_> = output
            .children()
            .filter(|node| node.is_element())
            .map(|node| (node.tag_name().namespace(), node.tag_name().name()))
            .collect();
        if source_children != output_children {
            return Err(format!("XHTML child element order changed in '{resource}'"));
        }
    }
    Ok(())
}

/// Validates all substitutions before touching the output destination.
fn preflight_epub(
    archive: &mut ZipArchive<File>,
    translated_chapters: Vec<TranslatedChapterPayload>,
) -> Result<HashMap<String, String>, String> {
    let mut translations = HashMap::new();
    let mut archive_names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect EPUB entry {index}: {error}"))?;
        if !archive_names.insert(entry.name().to_string()) {
            return Err(format!("Duplicate EPUB entry: {}", entry.name()));
        }
    }

    for chapter in translated_chapters {
        let name = chapter.internal_path;
        if name == "mimetype" || name.starts_with("META-INF/") {
            return Err(format!(
                "Protected EPUB resource cannot be replaced: '{name}'"
            ));
        }
        if !archive_names.contains(&name) {
            return Err(format!(
                "Translated resource not present in source EPUB: '{name}'"
            ));
        }
        if translations.contains_key(&name) {
            return Err(format!("Duplicate translation for EPUB resource: '{name}'"));
        }
        if chapter.content.trim().is_empty() {
            return Err(format!("Translated XHTML is empty: '{name}'"));
        }
        let mut entry = archive
            .by_name(&name)
            .map_err(|error| format!("Cannot open EPUB resource '{name}': {error}"))?;
        if entry.is_dir() {
            return Err(format!("Cannot translate a directory entry: '{name}'"));
        }
        if !name.to_ascii_lowercase().ends_with(".xhtml")
            && !name.to_ascii_lowercase().ends_with(".html")
            && !name.to_ascii_lowercase().ends_with(".htm")
        {
            return Err(format!(
                "Translation target is not an XHTML document: '{name}'"
            ));
        }
        let mut original_bytes = Vec::new();
        entry
            .read_to_end(&mut original_bytes)
            .map_err(|error| format!("Cannot read source chapter '{name}': {error}"))?;
        let original = std::str::from_utf8(&original_bytes)
            .map_err(|error| format!("Source chapter '{name}' is not UTF-8: {error}"))?;
        validate_translated_xhtml(original, &chapter.content, &name)?;
        translations.insert(name, chapter.content);
    }
    Ok(translations)
}

/// Creates an EPUB in the destination directory, then commits the completed ZIP.
/// On failure the existing destination remains untouched.
#[tauri::command]
async fn compile_epub(
    original_epub_path: String,
    output_epub_path: String,
    translated_chapters: Vec<TranslatedChapterPayload>,
) -> Result<(), String> {
    let source_path = Path::new(&original_epub_path);
    let destination = Path::new(&output_epub_path);
    if !source_path.is_file() {
        return Err("Source EPUB does not exist".to_string());
    }
    if destination.is_dir() {
        return Err("Output path points to a directory".to_string());
    }
    let source_canonical = fs::canonicalize(source_path)
        .map_err(|error| format!("Cannot resolve source EPUB path: {error}"))?;
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent_canonical = fs::canonicalize(parent)
        .map_err(|error| format!("Cannot resolve output directory: {error}"))?;
    let file_name = destination
        .file_name()
        .ok_or_else(|| "Invalid output EPUB file name".to_string())?;
    let resolved_output = parent_canonical.join(file_name);
    if source_canonical == resolved_output {
        return Err("Refusing to overwrite the source EPUB".to_string());
    }
    if destination.exists() {
        let existing = fs::canonicalize(destination)
            .map_err(|error| format!("Cannot resolve existing output file: {error}"))?;
        if existing == source_canonical {
            return Err("Refusing to overwrite the source EPUB through an alias".to_string());
        }
    }

    let original_file = File::open(&source_canonical)
        .map_err(|error| format!("Cannot open source EPUB: {error}"))?;
    let mut archive = ZipArchive::new(original_file)
        .map_err(|error| format!("Invalid source EPUB ZIP: {error}"))?;
    let translated_map = preflight_epub(&mut archive, translated_chapters)?;

    let mut mimetype_bytes = Vec::new();
    archive
        .by_name("mimetype")
        .map_err(|error| format!("Source EPUB is missing mimetype: {error}"))?
        .read_to_end(&mut mimetype_bytes)
        .map_err(|error| format!("Cannot read EPUB mimetype: {error}"))?;
    if mimetype_bytes != b"application/epub+zip" {
        return Err("Source EPUB has an invalid mimetype".to_string());
    }

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Cannot generate output timestamp: {error}"))?
        .as_nanos();
    let temporary = parent_canonical.join(format!(
        ".{}.{}.{}.epub.tmp",
        file_name.to_string_lossy(),
        std::process::id(),
        nonce
    ));

    let write_result = (|| -> Result<(), String> {
        let output_file = File::create_new(&temporary)
            .map_err(|error| format!("Cannot create temporary EPUB: {error}"))?;
        let mut writer = ZipWriter::new(output_file);
        let mimetype_options = FileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        writer
            .start_file("mimetype", mimetype_options)
            .map_err(|error| format!("Cannot write EPUB mimetype entry: {error}"))?;
        writer
            .write_all(&mimetype_bytes)
            .map_err(|error| format!("Cannot write EPUB mimetype: {error}"))?;

        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Cannot read source ZIP entry {index}: {error}"))?;
            let name = entry.name().to_string();
            if name == "mimetype" {
                continue;
            }
            let options = FileOptions::default()
                .compression_method(match entry.compression() {
                    CompressionMethod::Stored => CompressionMethod::Stored,
                    _ => CompressionMethod::Deflated,
                })
                .last_modified_time(entry.last_modified())
                .unix_permissions(entry.unix_mode().unwrap_or(0o644));
            if entry.is_dir() {
                writer
                    .add_directory(name, options)
                    .map_err(|error| format!("Cannot copy EPUB directory: {error}"))?;
            } else {
                writer
                    .start_file(name.clone(), options)
                    .map_err(|error| format!("Cannot create EPUB resource '{name}': {error}"))?;
                if let Some(translated) = translated_map.get(&name) {
                    writer.write_all(translated.as_bytes()).map_err(|error| {
                        format!("Cannot write translated resource '{name}': {error}")
                    })?;
                } else {
                    std::io::copy(&mut entry, &mut writer)
                        .map_err(|error| format!("Cannot copy EPUB resource '{name}': {error}"))?;
                }
            }
        }
        let completed = writer
            .finish()
            .map_err(|error| format!("Cannot finish output EPUB ZIP: {error}"))?;
        completed
            .sync_all()
            .map_err(|error| format!("Cannot sync completed EPUB: {error}"))?;

        // Validate the written ZIP before making it visible at the destination.
        let mut check = ZipArchive::new(
            File::open(&temporary)
                .map_err(|error| format!("Cannot reopen output EPUB: {error}"))?,
        )
        .map_err(|error| format!("Completed EPUB ZIP failed validation: {error}"))?;
        if check.len() != archive.len() {
            return Err("Output EPUB entry count differs from source".to_string());
        }
        let first = check
            .by_index(0)
            .map_err(|error| format!("Cannot inspect output mimetype: {error}"))?;
        if first.name() != "mimetype" || first.compression() != CompressionMethod::Stored {
            return Err("Output EPUB mimetype is not first and uncompressed".to_string());
        }
        drop(first);
        for name in translated_map.keys() {
            check.by_name(name).map_err(|error| {
                format!("Output EPUB is missing translated resource '{name}': {error}")
            })?;
        }
        drop(check);

        #[cfg(windows)]
        {
            if destination.exists() {
                replace_existing_cache(&temporary, destination)?;
            } else {
                fs::rename(&temporary, destination)
                    .map_err(|error| format!("Cannot publish completed EPUB: {error}"))?;
            }
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, destination)
                .map_err(|error| format!("Cannot publish completed EPUB: {error}"))?;
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result?;
    println!("Translated EPUB exported: {}", destination.display());
    Ok(())
}

/// Scans the application's cache directory and gathers metadata for all saved project files.

#[tauri::command]

async fn list_caches(app: AppHandle) -> Result<Vec<CacheMetadata>, String> {
    let dir = cache_directory(&app)?;

    let mut list = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(json_payload) = serde_json::from_str::<Value>(&content) {
                        let key = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string();

                        let epub_path = json_payload
                            .get("epub_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown")
                            .to_string();

                        let target_language = json_payload
                            .get("target_language")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let engine = json_payload
                            .get("engine")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let total_chapters = json_payload
                            .get("chapters")
                            .and_then(|v| v.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0);

                        list.push(CacheMetadata {
                            key,

                            epub_path,

                            target_language,

                            engine,

                            total_chapters,
                        });
                    }
                }
            }
        }
    }

    Ok(list)
}

/// Securely removes a target cache index file from the local AppData disk structure.

#[tauri::command]

async fn delete_cache(app: AppHandle, key_name: String) -> Result<(), String> {
    let path = cache_file_path(&app, &key_name)?;

    let _guard = cache_operation_lock()
        .lock()
        .map_err(|_| "Cache operation lock was poisoned".to_string())?;

    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to delete cache file: {e}"))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            select_epub,
            load_progress_cache,
            save_progress_cache,
            extract_epub_chapters,
            translate_text_free,
            translate_text_gemini,
            translate_text_ai,
            translate_segments,
            compile_epub,
            list_caches,
            delete_cache,
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while launching the Tauri application workspace");
}
#[cfg(test)]
mod epub_validation_tests {
    use super::validate_translated_xhtml;

    const SOURCE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head>
<body><p id="first">A <em>small</em> example &amp; text.</p></body></html>"#;

    #[test]
    fn accepts_text_only_translation() {
        let translated = SOURCE
            .replace("small", "pequeno")
            .replace("example", "exemplo");
        assert!(validate_translated_xhtml(SOURCE, &translated, "chapter.xhtml").is_ok());
    }

    #[test]
    fn rejects_attribute_changes() {
        let translated = SOURCE.replace("id=\"first\"", "id=\"other\"");
        assert!(validate_translated_xhtml(SOURCE, &translated, "chapter.xhtml").is_err());
    }

    #[test]
    fn rejects_missing_markup() {
        let translated = SOURCE.replace("<em>small</em>", "small");
        assert!(validate_translated_xhtml(SOURCE, &translated, "chapter.xhtml").is_err());
    }

    #[test]
    fn rejects_invalid_xml() {
        let translated = SOURCE.replace("&amp;", "&");
        assert!(validate_translated_xhtml(SOURCE, &translated, "chapter.xhtml").is_err());
    }
}

#[cfg(test)]
mod structured_translation_tests {
    use super::{parse_segment_response, validate_segment_sources, SegmentSource};

    fn sources() -> Vec<SegmentSource> {
        vec![
            SegmentSource {
                id: "chapter::t0".into(),
                text: "Hello ".into(),
            },
            SegmentSource {
                id: "chapter::t1".into(),
                text: "world".into(),
            },
        ]
    }

    #[test]
    fn accepts_out_of_order_ids_and_returns_source_order() {
        let raw = r#"{"translations":[{"id":"chapter::t1","translatedText":"mundo"},{"id":"chapter::t0","translatedText":"Olá "}]}"#;
        let result = parse_segment_response(raw, &sources()).unwrap();
        assert_eq!(result.translations[0].id, "chapter::t0");
        assert_eq!(result.translations[0].translated_text, "Olá ");
    }

    #[test]
    fn rejects_missing_unknown_duplicate_and_empty_translations() {
        for raw in [
            r#"{"translations":[{"id":"chapter::t0","translatedText":"Olá"}]}"#,
            r#"{"translations":[{"id":"chapter::t0","translatedText":"Olá"},{"id":"other","translatedText":"mundo"}]}"#,
            r#"{"translations":[{"id":"chapter::t0","translatedText":"Olá"},{"id":"chapter::t0","translatedText":"mundo"}]}"#,
            r#"{"translations":[{"id":"chapter::t0","translatedText":" "},{"id":"chapter::t1","translatedText":"mundo"}]}"#,
        ] {
            assert!(parse_segment_response(raw, &sources()).is_err());
        }
    }

    #[test]
    fn rejects_duplicate_source_ids() {
        let mut inputs = sources();
        inputs[1].id = inputs[0].id.clone();
        assert!(validate_segment_sources(&inputs).is_err());
    }
}
