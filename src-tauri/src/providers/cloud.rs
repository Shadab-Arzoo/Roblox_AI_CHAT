use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{ChatMessage, StreamChunk};

#[derive(Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OpenAiChatChunk {
    choices: Option<Vec<OpenAiChoice>>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    delta: Option<OpenAiDelta>,
}

#[derive(Deserialize)]
struct OpenAiDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiErrorChunk {
    error: Option<OpenAiErrorDetails>,
}

#[derive(Deserialize)]
struct OpenAiErrorDetails {
    message: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Option<Vec<OpenAiResponseChoice>>,
    #[allow(dead_code)]
    error: Option<OpenAiErrorDetails>,
}

#[derive(Deserialize)]
struct OpenAiResponseChoice {
    message: Option<OpenAiResponseMessage>,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: Option<String>,
}

#[derive(Clone)]
pub struct CloudClient {
    client: Client,
}

impl CloudClient {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .tcp_keepalive(Some(std::time::Duration::from_secs(15)))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Test API connection and key validity
    pub async fn test_connection(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
    ) -> Result<String, String> {
        let trimmed_url = base_url.trim_end_matches('/');
        let url = format!("{}/chat/completions", trimmed_url);

        let request = OpenAiChatRequest {
            model: model.to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "ping".to_string(),
            }],
            stream: false,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/forgepilot/forgepilot")
            .header("X-Title", "ForgePilot Roblox Agent")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API returned error {}: {}", status, body));
        }

        Ok("Connected successfully!".to_string())
    }

    /// Stream chat completions from any OpenAI-compatible endpoint with automatic fallback
    pub async fn chat_stream<F>(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
        messages: Vec<ChatMessage>,
        cancel: Arc<AtomicBool>,
        mut on_chunk: F,
    ) -> Result<String, String>
    where
        F: FnMut(StreamChunk),
    {
        let trimmed_url = base_url.trim_end_matches('/');
        let url = format!("{}/chat/completions", trimmed_url);

        let request = OpenAiChatRequest {
            model: model.to_string(),
            messages: messages.clone(),
            stream: true,
        };

        let response_result = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/forgepilot/forgepilot")
            .header("X-Title", "ForgePilot Roblox Agent")
            .json(&request)
            .send()
            .await;

        let response = match response_result {
            Ok(resp) => resp,
            Err(e) => {
                return Err(format!("Failed to connect to cloud provider: {}", e));
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let err_text = response.text().await.unwrap_or_default();
            return Err(format!("Provider Error (HTTP {}): {}", status, err_text));
        }

        let mut stream = response.bytes_stream();
        let mut full_response = String::new();
        let mut buffer = String::new();
        let mut stream_error: Option<String> = None;

        while let Some(chunk_result) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            let bytes = match chunk_result {
                Ok(b) => b,
                Err(e) => {
                    stream_error = Some(e.to_string());
                    break;
                }
            };

            let text = String::from_utf8_lossy(&bytes);
            buffer.push_str(&text);

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer.drain(..=newline_pos);

                if line.is_empty() {
                    continue;
                }

                // Skip SSE comments / keepalives (e.g. ": OPENROUTER PROCESSING")
                if line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        on_chunk(StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        return Ok(full_response);
                    }

                    // Check for error payload inside SSE data
                    if let Ok(err_chunk) = serde_json::from_str::<OpenAiErrorChunk>(data) {
                        if let Some(err) = err_chunk.error {
                            if let Some(msg) = err.message {
                                stream_error = Some(msg);
                                break;
                            }
                        }
                    }

                    if let Ok(parsed) = serde_json::from_str::<OpenAiChatChunk>(data) {
                        if let Some(choices) = parsed.choices {
                            if let Some(choice) = choices.first() {
                                if let Some(ref delta) = choice.delta {
                                    if let Some(ref content) = delta.content {
                                        full_response.push_str(content);
                                        on_chunk(StreamChunk {
                                            content: content.clone(),
                                            done: false,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // If the stream dropped prematurely or returned no tokens, attempt fallbacks
        if full_response.is_empty() && !cancel.load(Ordering::Relaxed) {
            // Fallback 1: Non-streaming request for the same model
            let fallback_request = OpenAiChatRequest {
                model: model.to_string(),
                messages: messages.clone(),
                stream: false,
            };

            if let Ok(fallback_resp) = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key.trim()))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://github.com/forgepilot/forgepilot")
                .header("X-Title", "ForgePilot Roblox Agent")
                .json(&fallback_request)
                .send()
                .await
            {
                if fallback_resp.status().is_success() {
                    if let Ok(json_resp) = fallback_resp.json::<OpenAiChatResponse>().await {
                        if let Some(choices) = json_resp.choices {
                            if let Some(choice) = choices.first() {
                                if let Some(ref msg) = choice.message {
                                    if let Some(ref content) = msg.content {
                                        on_chunk(StreamChunk {
                                            content: content.clone(),
                                            done: true,
                                        });
                                        return Ok(content.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Fallback 2: If the model is an OpenRouter model, automatically route through openrouter/free
            if model != "openrouter/free" && (model.contains(":free") || base_url.contains("openrouter")) {
                let auto_free_request = OpenAiChatRequest {
                    model: "openrouter/free".to_string(),
                    messages,
                    stream: false,
                };

                if let Ok(auto_resp) = self
                    .client
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", api_key.trim()))
                    .header("Content-Type", "application/json")
                    .header("HTTP-Referer", "https://github.com/forgepilot/forgepilot")
                    .header("X-Title", "ForgePilot Roblox Agent")
                    .json(&auto_free_request)
                    .send()
                    .await
                {
                    if auto_resp.status().is_success() {
                        if let Ok(json_resp) = auto_resp.json::<OpenAiChatResponse>().await {
                            if let Some(choices) = json_resp.choices {
                                if let Some(choice) = choices.first() {
                                    if let Some(ref msg) = choice.message {
                                        if let Some(ref content) = msg.content {
                                            on_chunk(StreamChunk {
                                                content: content.clone(),
                                                done: true,
                                            });
                                            return Ok(content.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return Err(format!(
                "Model '{}' was unavailable on OpenRouter ({}). Please switch to 'Auto Free' or 'North Code' above.",
                model,
                stream_error.unwrap_or_else(|| "endpoint timed out or empty response".to_string())
            ));
        }

        on_chunk(StreamChunk {
            content: String::new(),
            done: true,
        });

        Ok(full_response)
    }
}
