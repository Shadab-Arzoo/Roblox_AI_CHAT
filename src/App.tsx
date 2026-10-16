import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { ChatView } from "./components/ChatView";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  useDatabase,
  createConversation,
  listConversations,
  getConversation,
  addMessage,
  deleteConversation,
  renameConversation,
  searchConversations,
  setSetting,
  getSetting,
} from "./hooks/useDatabase";
import type {
  Conversation,
  ChatMessage,
  ProviderStatus,
  McpStatus,
  StreamChunk,
  WindowMode,
} from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ROBLOX_STUDIO_SYSTEM_PROMPT = `You are ForgePilot, the autonomous Roblox Studio developer engine.
You are connected directly to the user's active Roblox Studio workspace session.

ABSOLUTE MANDATES:
1. NEVER provide instructions, guides, manuals, or tutorials.
2. NEVER tell the user to "Open Roblox Studio", "Open Explorer", "Open Command Bar", "Paste this code", or "Press Run".
3. NEVER write text before or after the code block explaining how to use it.
4. When the user asks to build, create, spawn, modify, change the sky, add lighting, or script anything:
   - Output ONLY ONE brief status line: "⚡ Executing: [action description] in Roblox Studio Workspace..."
   - IMMEDIATELY follow with the full, complete, working Luau code block in \`\`\`luau ... \`\`\`.
   - Output NOTHING else.
5. All code is executed autonomously into the user's active Roblox Studio place. Ensure all Instances are anchored, parented to workspace (or appropriate service), sized, and colored.
6. If the user complains that you gave instructions or says "do it instead of explaining", DO NOT APOLOGIZE. IMMEDIATELY output the exact Luau code block to perform what they wanted.`;

function generateId(): string {
  return crypto.randomUUID();
}

export default function App() {
  // Initialize database
  useDatabase();

  // ─── State ────────────────────────────────────────────────────

  const [windowMode, setWindowMode] = useState<WindowMode>("compact");
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Provider
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("github");
  const [selectedModel, setSelectedModel] = useState<string | null>("gpt-4o");

  // MCP & Wiggle
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [autoRun, setAutoRun] = useState(true);
  const [wiggleEnabled, setWiggleEnabled] = useState(true);
  const [summonNotice, setSummonNotice] = useState<string | null>(null);

  // Streaming
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const streamMessageIdRef = useRef<string | null>(null);

  // ─── Initialization ───────────────────────────────────────────

  useEffect(() => {
    // Load conversations
    loadConversations();

    // Check provider status
    refreshProviderStatus();

    // Load saved provider & model
    getSetting("provider_type").then((p) => {
      if (p) setSelectedProvider(p);
    });

    getSetting("selectedModel").then((model) => {
      if (model) setSelectedModel(model);
    });

    getSetting("auto_run_studio").then((val) => {
      if (val !== null) setAutoRun(val === "true");
    });

    getSetting("wiggle_enabled").then((val) => {
      if (val !== null) {
        const isEn = val === "true";
        setWiggleEnabled(isEn);
        if (isTauri) {
          invoke("set_wiggle_enabled", { enabled: isEn }).catch(() => {});
        }
      }
    });

    // Auto-connect to Roblox Studio MCP if in Tauri
    if (isTauri) {
      invoke<McpStatus>("mcp_connect")
        .then((status) => setMcpStatus(status))
        .catch(() => {});
    }

    // Listen for stream & wiggle events
    let unlistenStream: (() => void) | undefined;
    let unlistenWiggle: (() => void) | undefined;

    if (isTauri) {
      try {
        listen<StreamChunk>("chat-stream", (event) => {
          const chunk = event.payload;
          setStreamContent((prev) => prev + chunk.content);
          if (chunk.done) {
            finalizeStream();
          }
        })
          .then((fn) => {
            unlistenStream = fn;
          })
          .catch(console.error);

        listen("studio-hard-wiggle", () => {
          setSummonNotice("⚡ Summoned from Roblox Studio via Hard Wiggle!");
          setTimeout(() => setSummonNotice(null), 3500);
        })
          .then((fn) => {
            unlistenWiggle = fn;
          })
          .catch(console.error);
      } catch (e) {
        console.error("Failed to attach event listeners:", e);
      }
    }

    return () => {
      unlistenStream?.();
      unlistenWiggle?.();
    };
  }, []);

  // ─── Conversation Management ──────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const convs = await listConversations();
      setConversations(convs);
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const conv = await getConversation(id);
      if (conv) {
        setActiveMessages(conv.messages);
        setActiveConversationId(id);
      }
    } catch (e) {
      console.error("Failed to load conversation:", e);
    }
  }, []);

  const handleNewConversation = useCallback(async () => {
    const id = generateId();
    const title = `Chat ${conversations.length + 1}`;
    await createConversation(id, title);
    await loadConversations();
    setActiveConversationId(id);
    setActiveMessages([]);
  }, [conversations.length, loadConversations]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      loadConversation(id);
    },
    [loadConversation]
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setActiveMessages([]);
      }
      await loadConversations();
    },
    [activeConversationId, loadConversations]
  );

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      await renameConversation(id, title);
      await loadConversations();
    },
    [loadConversations]
  );

  const handleSearchChange = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await searchConversations(query);
      setConversations(results);
    } else {
      await loadConversations();
    }
  }, [loadConversations]);

  // ─── Chat ─────────────────────────────────────────────────────

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedModel) return;

      let convId = activeConversationId;

      // Create conversation if none active
      if (!convId) {
        convId = generateId();
        const title = content.slice(0, 40) + (content.length > 40 ? "..." : "");
        await createConversation(convId, title);
        setActiveConversationId(convId);
        await loadConversations();
      }

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content,
        timestamp: Date.now(),
      };
      await addMessage(convId, userMessage);
      setActiveMessages((prev) => [...prev, userMessage]);

      // Prepare messages for API with Roblox Studio system context
      const apiMessages = [
        { role: "system", content: ROBLOX_STUDIO_SYSTEM_PROMPT },
        ...activeMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];

      // Start streaming
      setIsStreaming(true);
      setStreamContent("");
      const assistantMsgId = generateId();
      streamMessageIdRef.current = assistantMsgId;

      try {
        let result: string;
        if (selectedProvider === "ollama") {
          result = await invoke<string>("ollama_chat_stream", {
            model: selectedModel,
            messages: apiMessages,
            conversationId: convId,
          });
        } else {
          const apiKey = (await getSetting("cloud_api_key")) || "";
          const baseUrl =
            (await getSetting("cloud_base_url")) || "https://models.inference.ai.azure.com";
          result = await invoke<string>("cloud_chat_stream", {
            baseUrl,
            apiKey,
            model: selectedModel,
            messages: apiMessages,
            conversationId: convId,
          });
        }

        // Save assistant message
        const assistantMessage: ChatMessage = {
          id: assistantMsgId,
          role: "assistant",
          content: result,
          timestamp: Date.now(),
        };
        await addMessage(convId, assistantMessage);
        setActiveMessages((prev) => [...prev, assistantMessage]);

        // Auto-execute Luau code in Studio if enabled
        if (autoRun) {
          const match = result.match(/```(?:luau|lua)?\s*([\s\S]*?)```/);
          if (match && match[1]) {
            setTimeout(() => {
              handleExecuteInStudio(match[1].trim());
            }, 100);
          }
        }
      } catch (e: any) {
        const errorContent = `Error: ${e?.toString() || "Unknown error"}`;
        const errorMessage: ChatMessage = {
          id: assistantMsgId,
          role: "assistant",
          content: errorContent,
          timestamp: Date.now(),
        };
        await addMessage(convId!, errorMessage);
        setActiveMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsStreaming(false);
        setStreamContent("");
        streamMessageIdRef.current = null;
        await loadConversations();
      }
    },
    [selectedModel, activeConversationId, activeMessages, loadConversations]
  );

  const finalizeStream = useCallback(() => {
    // Stream is done — the invoke promise resolves and handles persistence
  }, []);

  // ─── Provider ─────────────────────────────────────────────────

  const refreshProviderStatus = useCallback(async () => {
    try {
      const status = await invoke<ProviderStatus>("ollama_status");
      setProviderStatus(status);
    } catch (e) {
      setProviderStatus({
        connected: false,
        provider_name: "Ollama",
        models: [],
        error: String(e),
      });
    }
  }, []);

  const handleSelectModel = useCallback(async (model: string) => {
    setSelectedModel(model);
    await setSetting("selectedModel", model);
  }, []);

  // ─── MCP ──────────────────────────────────────────────────────

  const handleMcpConnect = useCallback(async () => {
    try {
      const status = await invoke<McpStatus>("mcp_connect");
      setMcpStatus(status);
    } catch (e) {
      setMcpStatus({
        connected: false,
        server_name: null,
        server_version: null,
        tools_count: 0,
        error: String(e),
      });
    }
  }, []);

  const handleMcpDisconnect = useCallback(async () => {
    try {
      await invoke("mcp_disconnect");
      setMcpStatus({
        connected: false,
        server_name: null,
        server_version: null,
        tools_count: 0,
        error: null,
      });
    } catch (e) {
      console.error("Disconnect failed:", e);
    }
  }, []);

  // ─── Window Mode ──────────────────────────────────────────────

  const handleToggleMode = useCallback(async () => {
    const newMode = windowMode === "compact" ? "fullscreen" : "compact";
    try {
      if (isTauri) {
        if (newMode === "fullscreen") {
          await invoke("set_fullscreen_mode");
        } else {
          await invoke("set_compact_mode");
        }
      }
    } catch (e) {
      console.error("Mode toggle failed:", e);
    }
    setWindowMode(newMode);
  }, [windowMode]);

  const handleTogglePin = useCallback(async () => {
    const newValue = !alwaysOnTop;
    try {
      if (isTauri) {
        await invoke("set_always_on_top", { onTop: newValue });
      }
    } catch (e) {
      console.error("Pin toggle failed:", e);
    }
    setAlwaysOnTop(newValue);
  }, [alwaysOnTop]);

  const handleExecuteInStudio = useCallback(async (code: string): Promise<string> => {
    try {
      if (isTauri) {
        // 1. Direct Native Studio Automation: Injects and executes directly into open Place
        const directResult = await invoke<string>("studio_execute", { code });
        await navigator.clipboard.writeText(code).catch(() => {});
        return directResult;
      }
    } catch (e: any) {
      console.warn("Direct studio_execute returned:", e);

      // 2. Fallback to MCP if StudioMCP tool is connected
      try {
        if (mcpStatus?.connected) {
          const tools = await invoke<any[]>("mcp_tools").catch(() => []);
          const execTool = tools.find((t: any) =>
            t.name.includes("execute") ||
            t.name.includes("run") ||
            t.name.includes("script") ||
            t.name.includes("eval") ||
            t.name.includes("edit")
          );

          if (execTool) {
            let args: any = { code, script: code, command: code };
            if (execTool.name.includes("edit")) {
              args = {
                edits: [
                  {
                    path: "Workspace/ForgePilotAutonomousScript",
                    content: code,
                    action: "create",
                  },
                ],
              };
            }
            await invoke("mcp_call_tool", {
              toolName: execTool.name,
              arguments: args,
            });
            await navigator.clipboard.writeText(code).catch(() => {});
            return "⚡ Executed in Roblox Studio Workspace!";
          }
        }
      } catch (mcpErr) {
        console.error("MCP fallback failed:", mcpErr);
      }

      const errMsg = typeof e === "string" ? e : (e?.message || JSON.stringify(e));
      return errMsg.includes("Roblox Studio is not running")
        ? "⚠️ Roblox Studio not detected. Launch Studio & open a Place."
        : `⚡ ${errMsg}`;
    }

    await navigator.clipboard.writeText(code).catch(() => {});
    return "⚡ Luau script generated & copied.";
  }, [mcpStatus]);

  const handleToggleWiggle = useCallback(async () => {
    const next = !wiggleEnabled;
    setWiggleEnabled(next);
    await setSetting("wiggle_enabled", String(next));
    if (isTauri) {
      await invoke("set_wiggle_enabled", { enabled: next }).catch(console.error);
    }
  }, [wiggleEnabled]);

  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = shellRef.current;
    if (el) {
      el.scrollTop = 0;
      const handleScroll = () => {
        if (el.scrollTop !== 0) el.scrollTop = 0;
      };
      el.addEventListener("scroll", handleScroll, { passive: true });
      return () => el.removeEventListener("scroll", handleScroll);
    }
  }, []);

  const isFullscreen = windowMode === "fullscreen";

  return (
    <div
      ref={shellRef}
      className={`flex flex-col h-full w-full liquid-glass-shell overflow-hidden relative ${
        isFullscreen ? "rounded-none" : "rounded-2xl"
      }`}
    >
      {/* Ambient Liquid Glow Mesh in Background */}
      <div className="absolute -top-24 -left-24 w-72 h-72 bg-indigo-600/15 rounded-full blur-[80px] pointer-events-none liquid-orb-1" />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-purple-600/15 rounded-full blur-[80px] pointer-events-none liquid-orb-2" />

      {/* Summon Alert Notification Toast */}
      {summonNotice && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 summon-toast pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/90 text-white text-xs font-semibold shadow-xl shadow-accent/40 backdrop-blur-md border border-white/30">
            <span className="text-sm">⚡</span>
            <span>{summonNotice}</span>
          </div>
        </div>
      )}

      <TitleBar
        windowMode={windowMode}
        onToggleMode={handleToggleMode}
        alwaysOnTop={alwaysOnTop}
        onTogglePin={handleTogglePin}
        mcpConnected={mcpStatus?.connected || false}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex flex-1 min-h-0 relative">
        {/* Sidebar — fullscreen only */}
        {isFullscreen && (
          <Sidebar
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={handleSelectConversation}
            onNew={handleNewConversation}
            onDelete={handleDeleteConversation}
            onRename={handleRenameConversation}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
          />
        )}

        {/* Main chat area */}
        <ChatView
          conversationId={activeConversationId || ""}
          messages={activeMessages}
          selectedModel={selectedModel}
          onSendMessage={handleSendMessage}
          onExecuteCode={handleExecuteInStudio}
          onSelectModel={handleSelectModel}
          isStreaming={isStreaming}
          streamContent={streamContent}
          mcpConnected={mcpStatus?.connected || false}
          autoRunEnabled={autoRun}
          onToggleAutoRun={(enabled) => {
            setAutoRun(enabled);
            setSetting("auto_run_studio", String(enabled));
          }}
        />
      </div>

      <StatusBar
        provider={providerStatus}
        mcp={mcpStatus}
        selectedModel={selectedModel}
        selectedProvider={selectedProvider}
        wiggleEnabled={wiggleEnabled}
        onToggleWiggle={handleToggleWiggle}
        onProviderClick={() => setSettingsOpen(true)}
        onMcpClick={() => setSettingsOpen(true)}
      />

      {/* Settings Full Modal Overlay */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        providerStatus={providerStatus}
        mcpStatus={mcpStatus}
        selectedModel={selectedModel}
        selectedProvider={selectedProvider}
        wiggleEnabled={wiggleEnabled}
        onToggleWiggle={handleToggleWiggle}
        onSelectModel={handleSelectModel}
        onSelectProvider={setSelectedProvider}
        onProviderRefresh={refreshProviderStatus}
        onMcpConnect={handleMcpConnect}
        onMcpDisconnect={handleMcpDisconnect}
      />
    </div>
  );
}
