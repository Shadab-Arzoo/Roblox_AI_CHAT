import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../types";
import { invoke } from "@tauri-apps/api/core";

interface ChatViewProps {
  conversationId: string;
  messages: ChatMessage[];
  selectedModel: string | null;
  onSendMessage: (content: string) => void;
  onExecuteCode?: (code: string) => Promise<string>;
  onSelectModel?: (model: string) => void;
  isStreaming: boolean;
  streamContent: string;
  mcpConnected?: boolean;
  autoRunEnabled?: boolean;
  onToggleAutoRun?: (enabled: boolean) => void;
}

const POPULAR_FREE_MODELS = [
  { id: "openrouter/free", label: "Auto Free (Best)", desc: "OpenRouter Dynamic Free Router (Always Online)" },
  { id: "cohere/north-mini-code:free", label: "North Code", desc: "Cohere Mini Code (Ultra-Fast Luau)" },
  { id: "liquid/lfm-2.5-2.6b:free", label: "Liquid LFM", desc: "LiquidAI 2.5 (Fast & Lightweight)" },
  { id: "nvidia/nemotron-3.5-super-vl:free", label: "Nemotron Super", desc: "NVIDIA Super VL Free" },
];

export function ChatView({
  conversationId,
  messages,
  selectedModel,
  onSendMessage,
  onExecuteCode,
  onSelectModel,
  isStreaming,
  streamContent,
  mcpConnected = false,
  autoRunEnabled = true,
  onToggleAutoRun,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll ONLY inside the messages container - never scrolls the parent window
  useEffect(() => {
    if ((messages.length > 0 || isStreaming) && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, streamContent, isStreaming]);

  // Auto-focus input with preventScroll to ensure the TitleBar is NEVER pushed offscreen
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [conversationId]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput("");
  }, [input, isStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleCancel = useCallback(async () => {
    try {
      await invoke("cancel_stream");
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  }, []);

  // Find last user message for easy retry
  const lastUserPrompt = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const isSelectedInPresets = POPULAR_FREE_MODELS.some((m) => m.id === selectedModel);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-transparent relative z-10">
      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-3 select-none">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent via-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-accent/30 ring-1 ring-white/30 liquid-shimmer">
              <span className="text-2xl">⚡</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary tracking-tight">
                Roblox Studio Autonomous Builder
              </h3>
              <p className="text-[11px] text-text-muted max-w-[280px] leading-relaxed mx-auto">
                ForgePilot creates and executes Luau scripts directly into your open Roblox Studio session.
              </p>
            </div>

            {/* Compact 2x2 Quick Action Chips */}
            <div className="grid grid-cols-2 gap-1.5 w-full max-w-[340px] mt-1">
              {[
                { title: "Baseplate", prompt: "create a baseplate for me in my project" },
                { title: "Sprint & Stamina", prompt: "create a sprint system with stamina bar" },
                { title: "Sky Island", prompt: "create a sky block island with trees and coins" },
                { title: "Synthwave Sky", prompt: "change the sky to a neon synthwave nebula" },
              ].map(({ title, prompt }) => (
                <button
                  key={prompt}
                  onClick={() => onSendMessage(prompt)}
                  type="button"
                  className="text-left px-2.5 py-2 rounded-xl liquid-card text-text-secondary hover:text-text-primary hover:border-accent/40 transition-all flex flex-col justify-center group cursor-pointer"
                  title={prompt}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-semibold text-text-primary truncate">{title}</span>
                    <span className="text-accent text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">⚡</span>
                  </div>
                  <span className="text-[9px] text-text-muted truncate mt-0.5">{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onExecuteCode={onExecuteCode}
            mcpConnected={mcpConnected}
            onSelectModel={onSelectModel}
            onRetry={lastUserPrompt ? () => onSendMessage(lastUserPrompt) : undefined}
          />
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className="flex gap-3 message-enter">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 shadow-md shadow-accent/25">
              ⚡
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-accent font-semibold mb-1 flex items-center gap-2">
                <span>ForgePilot (Synthesizing &amp; Building...)</span>
                <span className="inline-block w-2 h-2 rounded-full bg-accent animate-ping" />
              </div>
              <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words liquid-bubble-assistant p-3.5 rounded-2xl">
                {streamContent ? (
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || "");
                        const codeString = String(children).replace(/\n$/, "");
                        if (!inline && (match || codeString.includes("\n"))) {
                          return (
                            <CodeBlock
                              code={codeString}
                              language={match ? match[1] : "luau"}
                              onExecuteCode={onExecuteCode}
                              mcpConnected={mcpConnected}
                            />
                          );
                        }
                        return (
                          <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-xs text-accent" {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {streamContent}
                  </ReactMarkdown>
                ) : (
                  <span className="flex gap-1.5 items-center text-text-muted py-1">
                    <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                    <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                    <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                    <span className="text-xs ml-1 font-mono text-accent/80">Connecting to Roblox Workspace...</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compact Unified Control Deck: Models + Auto-Execute + Input */}
      <div className="px-2.5 pt-1 pb-2 bg-bg-secondary/60 backdrop-blur-xl border-t border-white/[0.08] shrink-0">
        {/* Model strip & Auto-run in single row */}
        <div className="flex items-center justify-between gap-1 mb-1">
          {/* Scrollable Model Strip */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0 py-0.5">
            {!isSelectedInPresets && selectedModel && (
              <button
                onClick={() => onSelectModel?.(selectedModel)}
                type="button"
                className="px-2 py-0.5 rounded-full shrink-0 text-[10px] font-medium bg-accent/25 text-white border border-accent/60 shadow-sm cursor-pointer flex items-center gap-1"
                title={`Active custom model: ${selectedModel}`}
              >
                <span className="text-[8px] text-accent font-bold">✓</span>
                <span className="truncate max-w-[85px]">{selectedModel.split("/").pop()?.replace(":free", "") || selectedModel}</span>
              </button>
            )}
            {POPULAR_FREE_MODELS.map((m) => {
              const isCurrent = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelectModel?.(m.id)}
                  type="button"
                  className={`px-2 py-0.5 rounded-full shrink-0 text-[10px] font-medium transition-all cursor-pointer ${
                    isCurrent
                      ? "bg-accent/25 text-white border border-accent/60 shadow-sm font-semibold"
                      : "bg-white/[0.04] text-text-muted hover:text-text-primary hover:bg-white/[0.08] border border-white/[0.06]"
                  }`}
                  title={m.desc}
                >
                  {isCurrent && <span className="mr-0.5 text-[8px] text-accent">✓</span>}
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Auto-Run Toggle Pill */}
          <button
            onClick={() => onToggleAutoRun?.(!autoRunEnabled)}
            type="button"
            className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all cursor-pointer ${
              autoRunEnabled
                ? "bg-accent/20 text-white border border-accent/40 shadow-sm"
                : "bg-white/[0.05] text-text-muted hover:text-text-secondary border border-transparent"
            }`}
            title="Automatically run generated Luau directly into Studio without clicking"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRunEnabled ? "bg-accent animate-pulse" : "bg-text-muted"}`} />
            <span>Auto-Run: {autoRunEnabled ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* Input box */}
        <div className="relative flex items-end liquid-card rounded-xl focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40 transition-all shadow-md">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedModel
                ? "Ask ForgePilot to build or script in Roblox Studio..."
                : "Select an AI model above to start..."
            }
            disabled={!selectedModel || isStreaming}
            rows={1}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted px-3 py-2 resize-none outline-none max-h-24 min-h-[36px] disabled:opacity-50"
            style={{
              height: "auto",
              overflow: input.split("\n").length > 2 ? "auto" : "hidden",
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 96) + "px";
            }}
          />
          {isStreaming ? (
            <button
              onClick={handleCancel}
              type="button"
              className="m-1 px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors border border-red-500/30 cursor-pointer"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              type="button"
              disabled={!input.trim() || !selectedModel}
              className="m-1 px-2.5 py-1 rounded-lg bg-accent text-white font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-hover transition-all flex items-center gap-1 text-xs shadow-md shadow-accent/25 active:scale-95 cursor-pointer"
            >
              <span>Build</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8.5L7 12.5L13 3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Code Block with Autonomous Execution Button ─────────────────────

interface CodeBlockProps {
  code: string;
  language: string;
  onExecuteCode?: (code: string) => Promise<string>;
  mcpConnected?: boolean;
}

function CodeBlock({ code, language, onExecuteCode, mcpConnected }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execStatus, setExecStatus] = useState<string | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunInStudio = async () => {
    setExecuting(true);
    setExecStatus(null);
    try {
      if (onExecuteCode) {
        const result = await onExecuteCode(code);
        setExecStatus(result);
      } else {
        await navigator.clipboard.writeText(code);
        setExecStatus("⚡ Luau code copied.");
      }
    } catch (err: any) {
      setExecStatus(`Error: ${err?.message || String(err)}`);
    } finally {
      setExecuting(false);
      setTimeout(() => setExecStatus(null), 5000);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-white/[0.08] bg-[#07070e] overflow-hidden shadow-2xl">
      {/* Action Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-white/[0.03] border-b border-white/[0.08] text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-accent font-bold tracking-wider text-[11px] uppercase">
            {language || "luau"}
          </span>
          {execStatus && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
              {execStatus}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Main Action: Run in Studio */}
          <button
            onClick={handleRunInStudio}
            disabled={executing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-lg transition-all duration-150 ${
              execStatus
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-gradient-to-r from-accent via-purple-600 to-indigo-600 hover:brightness-110 shadow-accent/25 active:scale-95 cursor-pointer"
            }`}
            title="Execute directly into active Roblox Studio Workspace"
          >
            {executing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span>Executing...</span>
              </>
            ) : execStatus ? (
              <span>{execStatus}</span>
            ) : (
              <>
                <span className="text-sm">{mcpConnected ? "⚡" : "▶"}</span>
                <span>Run in Roblox Studio</span>
              </>
            )}
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-text-secondary hover:text-text-primary text-xs font-medium transition-colors border border-white/[0.08]"
            title="Copy script to clipboard"
          >
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
        </div>
      </div>

      {/* Code Body */}
      <pre className="p-3.5 text-xs font-mono overflow-x-auto text-emerald-300 leading-relaxed bg-[#05050a] selection:bg-accent/40">
        <code>{code}</code>
      </pre>

      {/* One-click studio runner footer */}
      <div className="px-3.5 py-1.5 bg-white/[0.02] border-t border-white/[0.04] flex items-center justify-between text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="text-accent font-semibold">⚡ Direct Execution:</span>
          <span>Click button above to inject into Roblox Studio Workspace</span>
        </span>
        <span className="font-mono text-[10px] text-text-muted/70">Studio Command Bar: Ctrl+V + Enter</span>
      </div>
    </div>
  );
}

// ─── Message Bubble Component with Error Recovery Card ─────────────

interface MessageBubbleProps {
  message: ChatMessage;
  onExecuteCode?: (code: string) => Promise<string>;
  mcpConnected?: boolean;
  onSelectModel?: (model: string) => void;
  onRetry?: () => void;
}

function MessageBubble({
  message,
  onExecuteCode,
  mcpConnected,
  onSelectModel,
  onRetry,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError =
    !isUser &&
    (message.content.startsWith("Error:") ||
      message.content.includes("Stream disconnected") ||
      message.content.includes("stream interrupted") ||
      message.content.includes("error decoding response body"));

  // If it's a provider dropout error, render the interactive Liquid Error Recovery Card
  if (isError) {
    return (
      <div className="flex gap-3 message-enter">
        <div className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-xs font-bold text-red-400 shrink-0 mt-0.5">
          ⚠️
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-red-400 font-semibold mb-1">
            Provider Stream Disconnected
          </div>
          <div className="liquid-card p-4 rounded-2xl border border-red-500/30 bg-red-950/20 space-y-3">
            <p className="text-xs text-text-primary leading-relaxed">
              The model endpoint on OpenRouter experienced an upstream connection drop or high-load timeout.
            </p>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Switch to a recommended stable free model:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  {
                    id: "openrouter/free",
                    label: "⚡ Auto Free (Recommended)",
                    badge: "Dynamic Router • Always Online",
                  },
                  {
                    id: "cohere/north-mini-code:free",
                    label: "⚡ North Mini Code",
                    badge: "Specialized Luau Code • <1s",
                  },
                  {
                    id: "liquid/lfm-2.5-2.6b:free",
                    label: "⚡ Liquid LFM 2.5",
                    badge: "Free & Ultra-Fast",
                  },
                ].map((alt) => (
                  <button
                    key={alt.id}
                    onClick={() => {
                      onSelectModel?.(alt.id);
                      if (onRetry) {
                        setTimeout(() => onRetry(), 100);
                      }
                    }}
                    className="flex flex-col text-left px-3 py-2 rounded-xl bg-bg-secondary/80 hover:bg-accent/20 border border-white/10 hover:border-accent/40 transition-all text-xs group"
                  >
                    <span className="font-semibold text-text-primary group-hover:text-accent">
                      {alt.label.replace("&amp;", "&")}
                    </span>
                    <span className="text-[10px] text-text-muted">{alt.badge.replace("&amp;", "&")}</span>
                  </button>
                ))}
              </div>
            </div>

            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-text-primary transition-colors border border-white/10"
              >
                <span>🔄 Retry prompt</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 message-enter ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 shadow-md ${
          isUser
            ? "bg-white/10 text-text-primary border border-white/15"
            : "bg-gradient-to-br from-accent to-purple-600 text-white shadow-accent/25 ring-1 ring-white/20"
        }`}
      >
        {isUser ? "U" : "⚡"}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        <div className="text-[11px] text-text-muted mb-1 font-semibold flex items-center gap-1.5">
          <span>{isUser ? "You" : "ForgePilot"}</span>
          {!isUser && (
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-accent/20 text-accent font-mono font-medium">
              Roblox Studio
            </span>
          )}
        </div>
        <div
          className={`text-sm leading-relaxed ${
            isUser
              ? "inline-block liquid-bubble-user text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] whitespace-pre-wrap break-words text-left font-medium"
              : "text-text-primary liquid-bubble-assistant p-4 rounded-2xl"
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  const codeString = String(children).replace(/\n$/, "");
                  if (!inline && (match || codeString.includes("\n"))) {
                    return (
                      <CodeBlock
                        code={codeString}
                        language={match ? match[1] : "luau"}
                        onExecuteCode={onExecuteCode}
                        mcpConnected={mcpConnected}
                      />
                    );
                  }
                  return (
                    <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-xs text-accent" {...props}>
                      {children}
                    </code>
                  );
                },
                p({ children }) {
                  return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
        <div className="text-[10px] text-text-muted mt-1 px-1">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
