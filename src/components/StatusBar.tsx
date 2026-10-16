import type { McpStatus, ProviderStatus } from "../types";

interface StatusBarProps {
  provider: ProviderStatus | null;
  mcp: McpStatus | null;
  selectedModel: string | null;
  selectedProvider: string;
  wiggleEnabled?: boolean;
  onProviderClick: () => void;
  onMcpClick: () => void;
  onToggleWiggle?: () => void;
}

export function StatusBar({
  provider,
  mcp,
  selectedModel,
  selectedProvider,
  wiggleEnabled = true,
  onProviderClick,
  onMcpClick,
  onToggleWiggle,
}: StatusBarProps) {
  const isCloud = selectedProvider !== "ollama";
  const isAiReady = isCloud ? Boolean(selectedModel) : Boolean(provider?.connected);

  const providerLabel = isCloud
    ? selectedProvider === "openrouter"
      ? "OpenRouter"
      : selectedProvider === "github"
      ? "GitHub"
      : selectedProvider === "gemini"
      ? "Gemini"
      : selectedProvider === "openai"
      ? "OpenAI"
      : "Cloud"
    : "Ollama";

  const displayModel = selectedModel
    ? selectedModel.split("/").pop()?.replace(":free", "") || selectedModel
    : "";

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-bg-secondary/80 backdrop-blur-2xl border-t border-white/[0.06] text-[10px] shrink-0 select-none relative z-20">
      {/* Provider status */}
      <button
        onClick={onProviderClick}
        type="button"
        className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors font-medium truncate min-w-0 mr-2 cursor-pointer"
        title={isAiReady ? `${providerLabel}: ${selectedModel} (Click to change)` : "Click to configure AI"}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAiReady ? "bg-emerald-400 status-pulse" : "bg-text-muted"}`} />
        <span className="truncate">{isAiReady ? `${providerLabel}: ${displayModel}` : "No AI Connected"}</span>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Wiggle Summon Indicator / Toggle */}
        <button
          onClick={onToggleWiggle}
          type="button"
          className={`flex items-center gap-1 text-[9px] font-medium transition-colors cursor-pointer px-1 py-0.5 rounded hover:bg-white/5 ${
            wiggleEnabled ? "text-accent hover:text-accent-hover" : "text-text-muted hover:text-text-secondary"
          }`}
          title="Hard cursor shake/wiggle in Roblox Studio automatically brings ForgePilot to front"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${wiggleEnabled ? "bg-accent animate-pulse" : "bg-white/20"}`} />
          <span>Wiggle: {wiggleEnabled ? "ON" : "OFF"}</span>
        </button>

        {/* MCP status */}
        <button
          onClick={onMcpClick}
          type="button"
          className="flex items-center gap-1 text-text-muted hover:text-text-primary transition-colors font-medium cursor-pointer"
          title="Roblox Studio MCP connection status — click to configure"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${mcp?.connected ? "bg-emerald-400 status-pulse" : "bg-amber-400"}`} />
          <span>{mcp?.connected ? `Studio (${mcp.tools_count})` : "Studio"}</span>
        </button>
      </div>
    </div>
  );
}
