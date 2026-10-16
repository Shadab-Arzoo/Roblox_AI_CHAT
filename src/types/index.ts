// ─── Chat & Messages ───────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Providers ─────────────────────────────────────────────────────

export type ProviderType = "ollama" | "openai" | "github" | "gemini" | "custom";

export interface CloudProviderConfig {
  providerType: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ProviderStatus {
  connected: boolean;
  provider_name: string;
  models: string[];
  error: string | null;
}

export interface ModelInfo {
  name: string;
  size: number | null;
  modified_at: string | null;
}

export interface StreamChunk {
  conversationId: string;
  content: string;
  done: boolean;
}

// ─── MCP ───────────────────────────────────────────────────────────

export interface McpStatus {
  connected: boolean;
  server_name: string | null;
  server_version: string | null;
  tools_count: number;
  error: string | null;
}

export interface McpTool {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

export interface StudioInstance {
  studio_id: string;
  name: string;
  place_id: string | null;
}

export interface ToolCallResult {
  success: boolean;
  content: unknown;
  error: string | null;
}

// ─── Projects ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  studioId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── App State ─────────────────────────────────────────────────────

export type WindowMode = "compact" | "fullscreen";

export interface AppSettings {
  alwaysOnTop: boolean;
  windowMode: WindowMode;
  selectedModel: string | null;
  selectedProvider: string;
  globalShortcut: string;
  mouseShakeEnabled: boolean;
  mouseShakeSensitivity: number;
}
