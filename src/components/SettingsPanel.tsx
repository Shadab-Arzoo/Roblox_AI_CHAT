import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "../hooks/useDatabase";
import type { ProviderStatus, McpStatus, ModelInfo, StudioInstance } from "../types";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  providerStatus: ProviderStatus | null;
  mcpStatus: McpStatus | null;
  selectedModel: string | null;
  selectedProvider: string;
  wiggleEnabled?: boolean;
  onToggleWiggle?: () => void;
  onSelectModel: (model: string) => void;
  onSelectProvider: (provider: string) => void;
  onProviderRefresh: () => void;
  onMcpConnect: () => void;
  onMcpDisconnect: () => void;
}

const PRESET_MODELS: Record<string, string[]> = {
  openrouter: [
    "openrouter/free",
    "cohere/north-mini-code:free",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-super-vl:free",
    "google/gemma-4-26b-a4b-it:free",
  ],
  github: [
    "gpt-4o",
    "gpt-4o-mini",
    "Meta-Llama-3.1-70B-Instruct",
    "Mistral-large",
  ],
  gemini: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "o3-mini",
    "o1",
  ],
  custom: [
    "deepseek/deepseek-r1",
    "anthropic/claude-3.7-sonnet",
    "meta-llama/llama-3.3-70b-instruct",
  ],
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  github: "https://models.inference.ai.azure.com",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  custom: "https://openrouter.ai/api/v1",
};

export function SettingsPanel({
  isOpen,
  onClose,
  providerStatus,
  mcpStatus,
  selectedModel,
  selectedProvider,
  wiggleEnabled = true,
  onToggleWiggle,
  onSelectModel,
  onSelectProvider,
  onProviderRefresh,
  onMcpConnect,
  onMcpDisconnect,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<"provider" | "studio" | "settings">("provider");
  
  // Ollama models
  const [ollamaModels, setOllamaModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Cloud provider states
  const [providerType, setProviderType] = useState<string>(selectedProvider || "github");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.github);
  const [customModel, setCustomModel] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Studio instances
  const [studios, setStudios] = useState<StudioInstance[]>([]);
  const [loadingStudios, setLoadingStudios] = useState(false);

  // Load saved provider settings on mount
  useEffect(() => {
    getSetting("provider_type").then((val) => {
      if (val) {
        setProviderType(val);
        onSelectProvider(val);
      }
    });
    getSetting("cloud_api_key").then((val) => {
      if (val) setApiKey(val);
    });
    getSetting("cloud_base_url").then((val) => {
      if (val) setBaseUrl(val);
    });
  }, [onSelectProvider]);

  // Load models for Ollama
  const loadOllamaModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const result = await invoke<ModelInfo[]>("ollama_models");
      setOllamaModels(result);
    } catch (e) {
      console.error("Failed to load models:", e);
      setOllamaModels([]);
    }
    setLoadingModels(false);
  }, []);

  const loadStudios = useCallback(async () => {
    if (!mcpStatus?.connected) return;
    setLoadingStudios(true);
    try {
      const result = await invoke<StudioInstance[]>("mcp_list_studios");
      setStudios(result);
    } catch (e) {
      console.error("Failed to list studios:", e);
      setStudios([]);
    }
    setLoadingStudios(false);
  }, [mcpStatus?.connected]);

  // Direct Studio detection state
  const [studioInfo, setStudioInfo] = useState<{ running: boolean; title: string; pid: number; bridge_connected?: boolean } | null>(null);
  const [checkingStudio, setCheckingStudio] = useState(false);
  const [testingStudioExec, setTestingStudioExec] = useState(false);
  const [studioExecMsg, setStudioExecMsg] = useState<string | null>(null);

  const checkStudio = useCallback(async () => {
    setCheckingStudio(true);
    try {
      const info = await invoke<{ running: boolean; title: string; pid: number; bridge_connected?: boolean }>("studio_status");
      setStudioInfo(info);
    } catch (e) {
      setStudioInfo({ running: false, title: "", pid: 0, bridge_connected: false });
    } finally {
      setCheckingStudio(false);
    }
  }, []);

  const handleTestStudioExecution = async () => {
    setTestingStudioExec(true);
    setStudioExecMsg(null);
    try {
      const testCode = `local p = Instance.new("Part"); p.Name = "ForgePilotTestPart"; p.BrickColor = BrickColor.new("Bright violet"); p.Material = Enum.Material.Neon; p.Size = Vector3.new(4,1,2); p.Position = Vector3.new(0, 5, 0); p.Anchored = true; p.Parent = workspace; print("⚡ ForgePilot Connected to Roblox Studio!")`;
      const res = await invoke<string>("studio_execute", { code: testCode });
      setStudioExecMsg(res);
    } catch (err: any) {
      setStudioExecMsg(`⚠️ ${err?.message || String(err)}`);
    } finally {
      setTestingStudioExec(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "provider" && providerType === "ollama") {
      loadOllamaModels();
    }
    if (isOpen && activeTab === "studio") {
      checkStudio();
      if (mcpStatus?.connected) {
        loadStudios();
      }
    }
  }, [isOpen, activeTab, providerType, loadOllamaModels, loadStudios, checkStudio, mcpStatus?.connected]);

  const handleProviderChange = async (type: string) => {
    setProviderType(type);
    onSelectProvider(type);
    await setSetting("provider_type", type);
    
    // Set default base url for that provider
    const defUrl = DEFAULT_BASE_URLS[type] || "";
    setBaseUrl(defUrl);
    await setSetting("cloud_base_url", defUrl);

    // Pick first default model
    if (PRESET_MODELS[type]?.length) {
      const firstModel = PRESET_MODELS[type][0];
      onSelectModel(firstModel);
      await setSetting("selectedModel", firstModel);
    }

    setTestResult(null);
  };

  const handleApiKeyChange = async (key: string) => {
    setApiKey(key);
    await setSetting("cloud_api_key", key);
    setTestResult(null);
  };

  const handleBaseUrlChange = async (url: string) => {
    setBaseUrl(url);
    await setSetting("cloud_base_url", url);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: "Please enter an API Key first." });
      return;
    }
    setTestingConnection(true);
    setTestResult(null);
    try {
      const modelToTest = selectedModel || PRESET_MODELS[providerType]?.[0] || "gpt-4o";
      const result = await invoke<string>("cloud_test_connection", {
        baseUrl,
        apiKey: apiKey.trim(),
        model: modelToTest,
      });
      setTestResult({ success: true, message: result });
    } catch (e: any) {
      setTestResult({ success: false, message: String(e) });
    }
    setTestingConnection(false);
  };

  if (!isOpen) return null;

  const isCloud = providerType !== "ollama";

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg-primary/95 backdrop-blur-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/[0.08] bg-bg-secondary/80 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">⚙️</span>
          <h2 className="text-xs font-bold text-text-primary">ForgePilot Settings</h2>
        </div>
        <button
          onClick={onClose}
          type="button"
          className="px-2.5 py-1 rounded-md text-[11px] font-medium text-text-primary hover:text-white bg-accent/20 hover:bg-accent/30 border border-accent/40 shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
        >
          <span>Done</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1L9 9M9 1L1 9" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] px-3.5 bg-bg-secondary/40 shrink-0">
        {(["provider", "studio", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab === "provider" ? "AI Provider" : tab === "studio" ? "Roblox Studio" : "Settings"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "provider" && (
          <div className="space-y-4">
            {/* Provider Selection Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Provider Source</label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {[
                  { id: "openrouter", label: "OpenRouter (Free)", desc: "DeepSeek R1, Llama 3.3, Qwen Free" },
                  { id: "gemini", label: "Google Gemini", desc: "Antigravity Models" },
                  { id: "github", label: "GitHub Models", desc: "Copilot / GPT-4o" },
                  { id: "openai", label: "OpenAI / Codex", desc: "GPT-4o, o3, Codex" },
                  { id: "custom", label: "Custom Endpoint", desc: "Enterprise / Other" },
                  { id: "ollama", label: "Ollama (Local)", desc: "Offline / Local" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      providerType === p.id
                        ? "border-accent bg-accent/10 text-text-primary shadow-sm"
                        : "border-border-subtle bg-bg-secondary/60 text-text-muted hover:border-text-muted/40 hover:text-text-secondary"
                    }`}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-[10px] text-text-muted">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Cloud Provider Configuration */}
            {isCloud ? (
              <div className="space-y-3 bg-bg-secondary/40 border border-border-subtle rounded-xl p-3.5">
                {/* API Key */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-secondary">
                      {providerType === "github"
                        ? "GitHub Token (PAT)"
                        : providerType === "openrouter"
                        ? "OpenRouter API Key"
                        : "API Key"}
                    </label>
                    <span className="text-[10px] text-text-muted">
                      {providerType === "openrouter" && "Free key from openrouter.ai/keys ($0 balance required)"}
                      {providerType === "github" && "Free token from github.com/settings/tokens"}
                      {providerType === "gemini" && "Free key from aistudio.google.com"}
                      {providerType === "openai" && "platform.openai.com/api-keys"}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={
                      providerType === "openrouter"
                        ? "sk-or-v1-..."
                        : providerType === "github"
                        ? "ghp_... or github_pat_..."
                        : providerType === "gemini"
                        ? "AIzaSy..."
                        : "sk-..."
                    }
                    className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Base URL (Advanced / Custom) */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-secondary">Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => handleBaseUrlChange(e.target.value)}
                    className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs font-mono text-text-secondary focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Preset Models */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">Select Model</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(PRESET_MODELS[providerType] || []).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          onSelectModel(m);
                          setSetting("selectedModel", m);
                          setTestResult(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                          selectedModel === m
                            ? "bg-accent text-white"
                            : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Model override */}
                <div className="space-y-1 pt-1">
                  <label className="text-[11px] text-text-muted">Or custom model name:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="e.g. gpt-4o, claude-3-7-sonnet"
                      className="flex-1 px-3 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => {
                        if (customModel.trim()) {
                          onSelectModel(customModel.trim());
                          setSetting("selectedModel", customModel.trim());
                        }
                      }}
                      className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg text-xs text-text-secondary"
                    >
                      Use
                    </button>
                  </div>
                </div>

                {/* Test Connection Button */}
                <div className="pt-2 flex items-center justify-between border-t border-border-subtle">
                  <button
                    onClick={handleTestConnection}
                    disabled={testingConnection || !apiKey.trim()}
                    className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
                  >
                    {testingConnection ? "Testing..." : "Test Connection"}
                  </button>
                  {selectedModel && (
                    <span className="text-[11px] text-text-muted">
                      Active: <span className="text-accent font-semibold">{selectedModel}</span>
                    </span>
                  )}
                </div>

                {/* Test Result Message */}
                {testResult && (
                  <div
                    className={`text-[11px] p-2.5 rounded-lg border ${
                      testResult.success
                        ? "bg-success/10 border-success/30 text-success"
                        : "bg-error/10 border-error/30 text-error"
                    }`}
                  >
                    {testResult.message}
                  </div>
                )}
              </div>
            ) : (
              /* Ollama section */
              <div className="space-y-3">
                <div className="bg-bg-secondary/60 rounded-lg border border-border-subtle p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${providerStatus?.connected ? "bg-success" : "bg-error"}`} />
                      <span className="text-xs font-medium text-text-primary">Ollama Local Server</span>
                    </div>
                    <button
                      onClick={onProviderRefresh}
                      className="text-[11px] text-accent hover:text-accent-hover transition-colors"
                    >
                      Refresh
                    </button>
                  </div>
                  {providerStatus?.error && (
                    <div className="text-[11px] text-error bg-error/10 rounded px-2 py-1.5">
                      {providerStatus.error}
                    </div>
                  )}
                  {!providerStatus?.connected && (
                    <div className="text-[11px] text-text-muted">
                      Make sure Ollama is running: <code className="bg-bg-active px-1 rounded text-text-secondary">ollama serve</code>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-secondary">Local Models</label>
                  {loadingModels ? (
                    <div className="text-[11px] text-text-muted">Loading models...</div>
                  ) : ollamaModels.length === 0 ? (
                    <div className="text-[11px] text-text-muted">
                      No models found. Pull a model: <code className="bg-bg-active px-1 rounded text-text-secondary">ollama pull llama3.2</code>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {ollamaModels.map((m) => (
                        <button
                          key={m.name}
                          onClick={() => onSelectModel(m.name)}
                          className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                            selectedModel === m.name
                              ? "bg-accent/15 text-accent border border-accent/30"
                              : "bg-bg-tertiary/40 text-text-secondary hover:bg-bg-hover border border-transparent"
                          }`}
                        >
                          <span className="truncate">{m.name}</span>
                          {m.size && (
                            <span className="text-text-muted text-[10px] ml-2 shrink-0">
                              {(m.size / 1e9).toFixed(1)}GB
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "studio" && (
          <div className="space-y-3">
            {/* Primary Direct Roblox Studio Execution Engine */}
            <div className="bg-bg-secondary/70 rounded-xl border border-white/10 p-3.5 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      studioInfo?.running
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                        : "bg-amber-400/80"
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold text-text-primary">
                      {studioInfo?.running ? "Roblox Studio Detected & Connected" : "Roblox Studio Not Detected"}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {studioInfo?.running
                        ? studioInfo.title || "Place Active • Ready for Direct Execution"
                        : "Launch Roblox Studio and open your Place"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={checkStudio}
                  disabled={checkingStudio}
                  type="button"
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 transition-all cursor-pointer"
                >
                  {checkingStudio ? "Checking..." : "Recheck"}
                </button>
              </div>

              {/* Status details pill */}
              <div className="p-2.5 rounded-lg bg-bg-tertiary/60 border border-white/[0.06] space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Execution Mode:</span>
                  <span className="font-semibold text-accent">⚡ Direct Workspace Automator</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Process:</span>
                  <span className="font-mono text-[10px] text-text-secondary">
                    {studioInfo?.running ? `RobloxStudioBeta.exe (PID: ${studioInfo.pid})` : "Inactive"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Auto-Run:</span>
                  <span className="font-semibold text-emerald-400">Enabled (Instant in Workspace)</span>
                </div>
              </div>

              {/* Test Studio Execution Action */}
              <div className="pt-1 flex flex-col gap-2">
                <button
                  onClick={handleTestStudioExecution}
                  disabled={testingStudioExec || !studioInfo?.running}
                  type="button"
                  className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-accent to-purple-600 hover:brightness-110 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {testingStudioExec ? (
                    <span>⚡ Executing Test in Studio...</span>
                  ) : (
                    <>
                      <span>⚡ Test Direct Execution in Studio</span>
                    </>
                  )}
                </button>
                {studioExecMsg && (
                  <div className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-[11px] text-emerald-300 font-mono text-center">
                    {studioExecMsg}
                  </div>
                )}
              </div>
            </div>

            {/* How Autonomous Execution Works Card */}
            <div className="bg-bg-secondary/40 border border-accent/20 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-accent">
                <span>⚡ How Autonomous Execution Works:</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                ForgePilot is designed to execute completely automatically. When you ask ForgePilot to create models, scripts, or change the sky/lighting in chat:
              </p>
              <ul className="space-y-1.5 text-[11px] text-text-muted list-disc pl-4">
                <li>ForgePilot synthesizes the complete Luau script.</li>
                <li>It directly runs the script inside your open Roblox Studio session.</li>
                <li>Everything appears immediately inside your 3D workspace. Zero manual setup required!</li>
              </ul>
            </div>

            {/* Advanced: Studio MCP Proxy (Optional) */}
            <div className="bg-bg-secondary/40 border border-white/[0.08] rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${mcpStatus?.connected ? "bg-success" : "bg-text-muted"}`} />
                  <span className="text-xs font-medium text-text-primary">
                    Advanced: Studio MCP ({mcpStatus?.connected ? "Connected" : "Standby"})
                  </span>
                </div>
                {mcpStatus?.connected ? (
                  <button
                    onClick={onMcpDisconnect}
                    type="button"
                    className="text-[11px] text-error hover:text-red-400 cursor-pointer"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={onMcpConnect}
                    type="button"
                    className="text-[11px] text-accent hover:text-accent-hover cursor-pointer"
                  >
                    Connect
                  </button>
                )}
              </div>
              {loadingStudios ? (
                <div className="text-[10px] text-text-muted">Scanning for MCP instances...</div>
              ) : studios.length > 0 ? (
                <div className="text-[10px] text-text-muted">
                  {studios.length} MCP instance(s) detected.
                </div>
              ) : null}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-3">
            {/* Hard Cursor Wiggle Setting */}
            <div className="p-3.5 bg-bg-secondary/60 rounded-xl border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚡</span>
                  <div>
                    <div className="text-xs font-semibold text-text-primary">Hard Wiggle Summon</div>
                    <div className="text-[10px] text-text-muted">Shake cursor in Studio to pop up ForgePilot</div>
                  </div>
                </div>
                <button
                  onClick={onToggleWiggle}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    wiggleEnabled
                      ? "bg-accent text-white shadow-sm shadow-accent/40"
                      : "bg-white/10 text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {wiggleEnabled ? "ENABLED" : "DISABLED"}
                </button>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed bg-bg-tertiary/60 p-2.5 rounded-lg border border-white/5">
                Vigorously shake your mouse left-and-right inside Roblox Studio to summon ForgePilot. Requires 5 rapid direction reversals and high travel speed so normal 3D camera pan or drawing never triggers it accidentally.
              </p>
            </div>

            <div className="p-3 bg-bg-secondary/60 rounded-xl border border-white/10 text-xs text-text-secondary space-y-2">
              <div className="font-semibold text-text-primary">About ForgePilot</div>
              <p className="text-text-muted text-[11px] leading-relaxed">
                ForgePilot is an autonomous AI companion for Roblox Studio. It integrates cloud &amp; local LLMs with Roblox Studio via Model Context Protocol (MCP) to write and execute Luau scripts directly in your game.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
