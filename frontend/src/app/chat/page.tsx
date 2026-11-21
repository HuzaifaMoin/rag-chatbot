"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import SourcesPanel from "@/components/SourcesPanel";
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

function toHistory(messages: Message[]): ChatTurn[] {
  // The conversation so far, without the backend's extra fields.
  return messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
}

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
  const [showSources, setShowSources] = useState(false); // the slide-over panel on phones
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Keyboard shortcuts: "/" jumps to the question box, Esc closes the sources panel.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = (event.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === "Escape") {
        setShowSources(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // Ask the backend. `earlier` is the conversation before this question.
  async function ask(question: string, earlier: Message[]) {
    // Only send a list when the user narrowed it down; null means "all my documents".
    const documentIds = excluded.size > 0 ? selectedDocs.map((d) => d.id) : null;
    setMessages([...earlier, { role: "user", content: question }]);
    setError("");
    setLoading(true);
    try {
      const response = await sendChat(question, toHistory(earlier), threadId, documentIds);
      setThreadId(response.thread_id);
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer, response }]);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      // Take the unanswered question back out of the list and put it back in the box.
      setMessages(earlier);
      setInput(question);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading || noneSelected) return;
    setInput("");
    ask(question, messages);
  }

  // Ask the last question again (drops the last answer, keeps everything before it).
  function regenerate() {
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    if (lastUser === -1 || loading) return;
    ask(messages[lastUser].content, messages.slice(0, lastUser));
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
    inputRef.current?.focus();
  }

  const lastIndex = messages.length - 1;
  const panel = <SourcesPanel docs={docs} excluded={excluded} onToggle={toggle} />;

  return (
    // Full screen height minus the 3.5rem (h-14) nav bar, so the text box stays visible.
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl">
      {/* Sources panel: a sidebar on wide screens... */}
      <aside aria-label="Your sources" className="hidden w-72 shrink-0 border-r px-4 py-5 lg:flex">
        {panel}
      </aside>

      {/* ...and a slide-over on phones (a permanent side panel would squeeze the chat). */}
      {showSources && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Sources">
          <button
            aria-label="Close sources"
            onClick={() => setShowSources(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-3 border-r bg-background px-4 py-5 shadow-xl">
            <button
              onClick={() => setShowSources(false)}
              className="self-end rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            >
              Close ✕
            </button>
            {panel}
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col px-4 py-4">
        <header className="flex items-center justify-between gap-2 border-b pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Chat</h1>
            {readyDocs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Searching {selectedDocs.length} of {readyDocs.length}{" "}
                {readyDocs.length === 1 ? "document" : "documents"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSources(true)}
              className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted lg:hidden"
            >
              Sources
              {readyDocs.length > 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  {selectedDocs.length}/{readyDocs.length}
                </span>
              )}
            </button>
            <button
              onClick={newChat}
              className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              New chat
            </button>
          </div>
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
              <p className="text-xs text-muted-foreground">
                Tip: press <kbd className="rounded border bg-card px-1.5 font-mono">/</kbd> to start typing.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <ChatMessage
              key={index}
              message={message}
              onRegenerate={
                index === lastIndex && message.role === "assistant" && !loading ? regenerate : undefined
              }
            />
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
            ref={inputRef}
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
