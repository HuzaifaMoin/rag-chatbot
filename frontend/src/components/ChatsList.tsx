"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/api";

// The saved chats: click to reopen, ✏️ to rename (inline), 🗑 to delete.
export default function ChatsList({
  chats,
  activeId,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: ConversationSummary[] | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (chat: ConversationSummary) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(chat: ConversationSummary) {
    setEditing(chat.id);
    setDraft(chat.title);
  }

  function finishEdit(event?: React.FormEvent) {
    event?.preventDefault();
    if (editing && draft.trim()) onRename(editing, draft.trim());
    setEditing(null);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <h2 className="text-lg font-semibold">Chats</h2>
      {chats === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : chats.length === 0 ? (
        <p className="text-xs text-muted-foreground">Your conversations will be saved here.</p>
      ) : (
        <ul aria-label="Saved chats" className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1">
          {chats.map((chat) => (
            <li key={chat.id}>
              {editing === chat.id ? (
                <form onSubmit={finishEdit}>
                  <input
                    autoFocus
                    value={draft}
                    maxLength={200}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => finishEdit()}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    aria-label="Chat name"
                    className="w-full rounded-lg border border-ring bg-card px-2 py-1.5 text-sm outline-none"
                  />
                </form>
              ) : (
                <div
                  className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                    chat.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <button
                    onClick={() => onOpen(chat.id)}
                    aria-current={chat.id === activeId ? "true" : undefined}
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                  >
                    {chat.title}
                  </button>
                  <button
                    onClick={() => startEdit(chat)}
                    aria-label={`Rename ${chat.title}`}
                    className="rounded px-1 text-xs opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => onDelete(chat)}
                    aria-label={`Delete ${chat.title}`}
                    className="rounded px-1 text-xs opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100"
                  >
                    🗑
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
