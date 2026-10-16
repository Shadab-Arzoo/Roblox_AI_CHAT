use reqwest::Client;
use serde::{Deserialize, Serialize};
use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{ChatMessage, ModelInfo, ProviderStatus, StreamChunk};

const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";

/// Ollama API client
#[derive(Clone)]
pub struct OllamaClient {
    client: Client,
    base_url: String,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModel>>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
}

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaChatChunk {
    message: Option<OllamaChatMessage>,
    done: bool,
}

#[derive(Deserialize)]
struct OllamaChatMessage {
    content: String,
}

impl OllamaClient {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string()),
        }
    }

    /// Check connection and list available models
    pub async fn status(&self) -> ProviderStatus {
        match self.list_models().await {
            Ok(models) => ProviderStatus {
                connected: true,
                provider_name: "Ollama".to_string(),
                models: models.iter().map(|m| m.name.clone()).collect(),
                error: None,
            },
            Err(e) => ProviderStatus {
                connected: false,
                provider_name: "Ollama".to_string(),
                models: vec![],
                error: Some(e),
            },
        }
    }

    /// List installed models
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let url = format!("{}/api/tags", self.base_url);
        let resp = self.client.get(&url).send().await
            .map_err(|e| format!("Failed to connect to Ollama at {}: {}", self.base_url, e))?;

        let tags: OllamaTagsResponse = resp.json().await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(tags.models.unwrap_or_default().into_iter().map(|m| ModelInfo {
            name: m.name,
            size: m.size,
            modified_at: m.modified_at,
        }).collect())
    }

    /// Send a chat request (non-streaming) and return the full response
    pub async fn chat(&self, model: &str, messages: Vec<ChatMessage>) -> Result<String, String> {
        let url = format!("{}/api/chat", self.base_url);
        let req = OllamaChatRequest {
            model: model.to_string(),
            messages,
            stream: false,
        };

        let resp = self.client.post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Ollama chat request failed: {}", e))?;

        let chunk: OllamaChatChunk = resp.json().await
            .map_err(|e| format!("Failed to parse Ollama chat response: {}", e))?;

        Ok(chunk.message.map(|m| m.content).unwrap_or_default())
    }

    /// Stream a chat response, calling the callback for each chunk.
    /// Returns the full assembled response. Cancellable via the cancel flag.
    pub async fn chat_stream<F>(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        cancel: Arc<AtomicBool>,
        mut on_chunk: F,
    ) -> Result<String, String>
    where
        F: FnMut(StreamChunk) + Send,
    {
        let url = format!("{}/api/chat", self.base_url);
        let req = OllamaChatRequest {
            model: model.to_string(),
            messages,
            stream: true,
        };

        let resp = self.client.post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Ollama stream request failed: {}", e))?;

        let mut stream = resp.bytes_stream();
        let mut full_response = String::new();
        let mut buffer = Vec::new();

        while let Some(chunk_result) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                return Err("Request cancelled".to_string());
            }

            let bytes = chunk_result
                .map_err(|e| format!("Stream error: {}", e))?;

            buffer.extend_from_slice(&bytes);

            // Process complete JSON lines from buffer
            while let Some(newline_pos) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=newline_pos).collect();
                let line_str = String::from_utf8_lossy(&line);
                let trimmed = line_str.trim();
                if trimmed.is_empty() {
                    continue;
                }

                if let Ok(chunk) = serde_json::from_str::<OllamaChatChunk>(trimmed) {
                    let content = chunk.message.map(|m| m.content).unwrap_or_default();
                    full_response.push_str(&content);
                    on_chunk(StreamChunk {
                        content,
                        done: chunk.done,
                    });
                    if chunk.done {
                        return Ok(full_response);
                    }
                }
            }
        }

        Ok(full_response)
    }
}
