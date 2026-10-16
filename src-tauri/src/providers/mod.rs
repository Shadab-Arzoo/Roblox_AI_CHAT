pub mod ollama;
pub mod cloud;

use serde::{Deserialize, Serialize};

/// Common message format used across all providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// A streaming chunk from a provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

/// Provider connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub connected: bool,
    pub provider_name: String,
    pub models: Vec<String>,
    pub error: Option<String>,
}

/// Model info returned by providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
}
