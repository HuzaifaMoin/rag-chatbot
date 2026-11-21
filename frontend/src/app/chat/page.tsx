"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import StatusBadge from "@/components/StatusBadge";
import {
  listDocuments,
  sendChat,
  UnauthorizedError,
  type ChatTurn,
  type DocumentItem,
} from "@/lib/api";

// The backend accepts up to 40 earlier turns; we send the most recent 20.
const MAX_HISTORY = 20;

const SUGGESTIONS = [
  "Summarise my documents in a few bullet points",
  "What are the most important facts in my documents?",
  "What is 15% of 2,400?",
];

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  // Sources the user unticked (like NotebookLM's checkboxes). Empty = use every document.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load the user's documents for the sources panel. Also our login check: 401 -> login page.
  useEffect(() => {
    listDocuments()
      .then(setDocs)
      .catch((err) => {
        if (err instanceof UnauthorizedError) router.push("/login");
        else setDocs([]);
      });
  }, [router]);

  // Whenever the message list changes, scroll so the newest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const readyDocs = (docs ?? []).filter((d) => d.status === "ready");
  const selectedDocs = readyDocs.filter((d) => !excluded.has(d.id));
  const noneSelected = readyDocs.length > 0 && selectedDocs.length === 0;

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading || noneSelected) return;

    // History = the conversation so far, without the backend's extra fields.
    const history: ChatTurn[] = messages
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    // Only send a list when the user narrowed it down; null means "all my documents".
    const documentIds = excluded.size > 0 ? selectedDocs.map((d) => d.id) : null;

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await sendChat(question, history, threadId, documentIds);
      setThreadId(response.thread_id);
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer, response }]);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      // Take the unanswered question back out of the list and put it back in the box.
      setMessages((prev) => prev.slice(0, -1));
      setInput(question);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter makes a new line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function newChat() {
    setMessages([]);
    setThreadId(null);
    setError("");
  }

  return (
    // Full screen height minus the 3.5rem (h-14) nav bar, so the text box stays visible.
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl">
      {/* Sources panel (wide screens only; on phones it would squeeze the chat). */}
      <aside
        aria-label="Your sources"
        className="hidden w-72 shrink-0 flex-col gap-3 border-r px-4 py-5 lg:flex"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your sources</h2>
          <Link href="/documents" className="text-xs font-medium text-primary-ink hover:underline">
            Manage
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Untick a document to leave it out of the answers.
        </p>
        {docs === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <Link
            href="/documents"
            className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground hover:border-brand hover:text-foreground"
          >
            No documents yet.
            <br />
            <span className="font-medium text-primary-ink">Upload one →</span>
          </Link>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {docs.map((doc) => (
              <li key={doc.id}>
                <label
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted ${
                    doc.status !== "ready" ? "cursor-default opacity-60" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--primary)]"
                    checked={doc.status === "ready" && !excluded.has(doc.id)}
                    disabled={doc.status !== "ready"}
                    onChange={() => toggle(doc.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{doc.filename}</span>
                    <StatusBadge doc={doc} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col px-4 py-4">
        <header className="flex items-center justify-between border-b pb-3">
          <div>
            <h1 className="text-2xl font-semibold">Chat</h1>
            {readyDocs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Searching {selectedDocs.length} of {readyDocs.length}{" "}
                {readyDocs.length === 1 ? "document" : "documents"}
              </p>
            )}
          </div>
          <button
            onClick={newChat}
            className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            New chat
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto py-5">
          {messages.length === 0 && (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-2xl">
                💬
              </span>
              <div>
                <h2 className="text-xl font-semibold">Ask anything about your documents</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Answers come with sources. Hover a number like{" "}
                  <span className="rounded-md bg-accent px-1.5 text-xs font-semibold text-accent-foreground">
                    1
                  </span>{" "}
                  to see the passage.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={loading || noneSelected}
                    className="rounded-full border bg-card px-4 py-2 text-sm transition-colors hover:border-brand hover:bg-accent disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))}
          {loading && (
            <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-md border bg-card px-4 py-3">
              <span className="sr-only">Thinking…</span>
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-brand"
                  style={{ animationDelay: `${delay}ms` }}
                  aria-hidden="true"
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {noneSelected && (
          <p className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            Tick at least one source to ask a question.
          </p>
        )}

        <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
            rows={2}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim() || noneSelected}
            className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </section>
    </main>
  );
}
