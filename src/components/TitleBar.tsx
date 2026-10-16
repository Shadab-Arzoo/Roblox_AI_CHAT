import { invoke } from "@tauri-apps/api/core";
import type { WindowMode } from "../types";

interface TitleBarProps {
  windowMode: WindowMode;
  onToggleMode: () => void;
  alwaysOnTop: boolean;
  onTogglePin: () => void;
  mcpConnected?: boolean;
  onOpenSettings?: () => void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function TitleBar({
  windowMode,
  onToggleMode,
  alwaysOnTop,
  onTogglePin,
  mcpConnected = false,
  onOpenSettings,
}: TitleBarProps) {
  const isCompact = windowMode === "compact";

  const handleMinimize = async () => {
    if (isTauri) {
      try {
        await invoke("minimize_window");
      } catch {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          getCurrentWindow().minimize();
        } catch (e) {
          console.error("Minimize failed:", e);
        }
      }
    }
  };

  const handleClose = async () => {
    if (isTauri) {
      try {
        await invoke("close_window");
      } catch {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          getCurrentWindow().close();
        } catch (e) {
          console.error("Close failed:", e);
        }
      }
    }
  };

  return (
    <div
      className="flex items-center justify-between h-9 px-3 bg-bg-secondary/80 backdrop-blur-2xl border-b border-white/[0.08] select-none shrink-0 relative z-30"
      style={{ borderRadius: isCompact ? "14px 14px 0 0" : "0" }}
    >
      {/* Top Specular Liquid Highlight */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />

      {/* Logo & Title - Drag Region */}
      <div className="flex items-center gap-2 cursor-grab py-0.5 select-none" data-tauri-drag-region>
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-accent via-purple-600 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow-sm shadow-accent/30 ring-1 ring-white/25 pointer-events-none">
          ⚡
        </div>
        <div className="flex items-center gap-1.5 pointer-events-none">
          <span className="text-xs font-bold text-text-primary tracking-wide">
            ForgePilot
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-accent/20 text-accent font-medium font-mono border border-accent/30">
            Roblox
          </span>
        </div>
      </div>

      {/* Center Drag Region Spacer */}
      <div className="flex-1 h-full cursor-grab min-w-2" data-tauri-drag-region />

      {/* Controls Container (NO drag-region so buttons are always 100% clickable) */}
      <div className="flex items-center gap-0.5 shrink-0 relative z-20 pointer-events-auto">
        {/* Studio Quick Status Pill */}
        <button
          onClick={onOpenSettings}
          type="button"
          className={`hidden xs:flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all mr-1 cursor-pointer ${
            mcpConnected
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
              : "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
          }`}
          title="Click to configure Roblox Studio connection"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${mcpConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          <span>{mcpConnected ? "Studio Connected" : "Studio Offline"}</span>
        </button>

        {/* Settings gear */}
        <button
          onClick={onOpenSettings}
          type="button"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors cursor-pointer border border-transparent"
          title="Open Settings (API Keys, Models, Studio MCP, Wiggle)"
        >
          ⚙️
        </button>

        {/* Pin toggle */}
        <button
          onClick={onTogglePin}
          type="button"
          className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] transition-all cursor-pointer ${
            alwaysOnTop
              ? "text-accent bg-accent/20 border border-accent/40 shadow-sm shadow-accent/25"
              : "text-text-muted hover:text-text-secondary hover:bg-white/10 border border-transparent"
          }`}
          title={alwaysOnTop ? "Always on top (Active)" : "Pin on top"}
        >
          📌
        </button>

        {/* Expand / Collapse */}
        <button
          onClick={onToggleMode}
          type="button"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors cursor-pointer border border-transparent"
          title={isCompact ? "Expand to Fullscreen" : "Compact Mode"}
        >
          {isCompact ? "⬜" : "🔲"}
        </button>

        {/* Minimize */}
        <button
          onClick={handleMinimize}
          type="button"
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors cursor-pointer"
          title="Minimize"
        >
          <svg width="8" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" rx="0.5" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          type="button"
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          title="Close"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1L9 9M9 1L1 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
