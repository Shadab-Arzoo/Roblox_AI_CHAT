import { useState, useCallback } from "react";
import type { Conversation } from "../types";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  searchQuery,
  onSearchChange,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  }, []);

  const handleFinishRename = useCallback(() => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  }, [editingId, editTitle, onRename]);

  return (
    <div className="flex flex-col w-56 bg-bg-primary/90 border-r border-border-subtle h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-secondary">Chats</span>
        <button
          onClick={onNew}
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-sm"
          title="New chat"
        >
          +
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search chats..."
          className="w-full bg-bg-tertiary/60 border border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-accent/40 transition-colors"
        />
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5">
        {conversations.length === 0 && (
          <div className="text-[11px] text-text-muted text-center py-6">
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
              activeId === conv.id
                ? "bg-accent/10 text-text-primary"
                : "text-text-secondary hover:bg-bg-hover"
            }`}
            onClick={() => onSelect(conv.id)}
          >
            {editingId === conv.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFinishRename();
                  if (e.key === "Escape") {
                    setEditingId(null);
                    setEditTitle("");
                  }
                }}
                className="flex-1 bg-bg-tertiary border border-accent/40 rounded px-1.5 py-0.5 text-xs text-text-primary outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="flex-1 text-xs truncate">{conv.title}</span>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(conv.id, conv.title);
                    }}
                    className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-active transition-colors"
                    title="Rename"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this conversation?")) {
                        onDelete(conv.id);
                      }
                    }}
                    className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
