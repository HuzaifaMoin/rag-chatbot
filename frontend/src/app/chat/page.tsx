"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AgentSteps from "@/components/AgentSteps";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import ChatsList from "@/components/ChatsList";
import SourcesPanel from "@/components/SourcesPanel";
import {
  deleteConversation,
  getConversation,
  listConversations,
  listDocuments,
  renameConversation,
  sendChat,
  streamChat,
  StreamUnavailableError,
  UnauthorizedError,
  type AgentStep,
  type ChatOptions,
  type ChatResponse,
  type ChatTurn,
  type ConversationSummary,
  type DocumentItem,
} from "@/lib/api";
import { toast } from "@/lib/toast";

// The backend accepts up to 40 earlier turns; we send the most recent 20 (new chats only).
const MAX_HISTORY = 20;
const LAST_CHAT_KEY = "rag_last_chat"; // reopen the chat you were in after a refresh

const SUGGESTIONS = [
  "Summarise my documents in a few bullet points",
  "What are the most important facts in my documents?",
  "What is 15% of 2,400?",
];

// A step event either starts a new step or finishes the latest running one with the same name.
function upsertStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  if (step.status === "done") {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].node === step.node && steps[i].status === "running") {
        return steps.map((s, j) => (j === i ? step : s));
      }
    }
  }
  return [...steps, step];
}

function toHistory(messages: Message[]): ChatTurn[] {
  // The conversation so far, without the backend's extra fields.
  return messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_CHAT_KEY, id);
    else localStorage.removeItem(LAST_CHAT_KEY);
  } catch {
    // storage blocked: the chat still works, it just won't reopen after a refresh
  }
}

function recall(): string | null {
  try {
    return localStorage.getItem(LAST_CHAT_KEY);
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  // Sources the user unticked (like NotebookLM's checkboxes). Empty = use every document.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showPanel, setShowPanel] = useState(false); // the slide-over panel on phones
  // The answer being streamed right now: the agent's steps so far and the text so far.
  const [live, setLive] = useState<{ steps: AgentStep[]; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) router.push("/login");
      return err instanceof UnauthorizedError;
    },
    [router],
  );

  const refreshChats = useCallback(() => {
    return listConversations()
      .then((list) => {
        setChats(list);
        return list;
      })
      .catch((err) => {
        if (!handleAuth(err)) setChats([]);
        return [] as ConversationSummary[];
      });
  }, [handleAuth]);

  // Open a saved chat: load its messages (answers come back with their sources and steps).
  const openChat = useCallback(
    async (id: string) => {
      try {
        const chat = await getConversation(id);
        setMessages(
          chat.messages.map((m): Message =>
            m.role === "assistant" && m.response
              ? { role: "assistant", content: m.content, response: m.response, steps: m.response.steps }
              : { role: "user", content: m.content },
          ),
        );
        setConversationId(id);
        setError("");
        setShowPanel(false);
        remember(id);
      } catch (err) {
        if (!handleAuth(err)) {
          remember(null); // it was deleted: forget it
          toast("That chat couldn't be opened", "error");
        }
      }
    },
    [handleAuth],
  );

  // On load: documents for the sources panel (also our login check), saved chats, and
  // reopen the chat you were in before a refresh.
  useEffect(() => {
    listDocuments()
      .then(setDocs)
      .catch((err) => {
        if (!handleAuth(err)) setDocs([]);
      });
    refreshChats().then((list) => {
      const last = recall();
      if (last && list.some((c) => c.id === last)) openChat(last);
    });
  }, [handleAuth, refreshChats, openChat]);

  // Whenever the message list changes, scroll so the newest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, live]);

  // Keyboard shortcuts: "/" jumps to the question box, Esc closes the side panel.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = (event.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === "Escape") {
        setShowPanel(false);
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
  async function ask(question: string, earlier: Message[], replaceLast = false) {
    const options: ChatOptions = {
      conversationId,
      // Saved chats load their own history on the server; a new chat sends what's on screen.
      history: conversationId ? [] : toHistory(earlier),
      // Only send a list when the user narrowed it down; null means "all my documents".
      documentIds: excluded.size > 0 ? selectedDocs.map((d) => d.id) : null,
      replaceLast,
    };
    setMessages([...earlier, { role: "user", content: question }]);
    setError("");
    setLoading(true);
    setLive({ steps: [], text: "" });
    try {
      let steps: AgentStep[] = [];
      let started = false; // did any event arrive? (if not, we can quietly fall back)
      let response: ChatResponse;
      try {
        response = await streamChat(question, options, {
          onStep: (step) => {
            started = true;
            steps = upsertStep(steps, step);
            setLive((l) => l && { ...l, steps });
          },
          onToken: (text) => {
            started = true;
            setLive((l) => l && { ...l, text: l.text + text });
          },
          onReset: () => setLive((l) => l && { ...l, text: "" }),
        });
      } catch (err) {
        // Streaming not available (old backend, proxy...): use the normal endpoint instead.
        if (!(err instanceof StreamUnavailableError) || started) throw err;
        response = await sendChat(question, options);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.answer, response, steps: steps.length ? steps : undefined },
      ]);
      if (response.conversation_id) {
        setConversationId(response.conversation_id);
        remember(response.conversation_id);
        refreshChats(); // new chat appears / moves to the top
      }
    } catch (err) {
      if (handleAuth(err)) return;
      // Take the unanswered question back out of the list and put it back in the box.
      setMessages(earlier);
      setInput(question);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLive(null);
      setLoading(false);
    }
  }

  function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading || noneSelected) return;
    setInput("");
    ask(question, messages);
  }

  // Ask the last question again: the old answer is replaced (on screen and in the saved chat).
  function regenerate() {
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    if (lastUser === -1 || loading) return;
    ask(messages[lastUser].content, messages.slice(0, lastUser), true);
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
    setConversationId(null);
    setError("");
    setShowPanel(false);
    remember(null);
    inputRef.current?.focus();
  }

  async function rename(id: string, title: string) {
    try {
      await renameConversation(id, title);
      setChats((prev) => prev?.map((c) => (c.id === id ? { ...c, title } : c)) ?? prev);
    } catch (err) {
      if (!handleAuth(err)) toast("Couldn't rename the chat", "error");
    }
  }

  async function remove(chat: ConversationSummary) {
    if (!confirm(`Delete the chat "${chat.title}"?`)) return;
    try {
      await deleteConversation(chat.id);
      setChats((prev) => prev?.filter((c) => c.id !== chat.id) ?? prev);
      if (chat.id === conversationId) newChat();
      toast("Chat deleted");
    } catch (err) {
      if (!handleAuth(err)) toast("Couldn't delete the chat", "error");
    }
  }

  const lastIndex = messages.length - 1;
  const panel = (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="max-h-[45%] min-h-0 shrink-0 overflow-hidden">
        <ChatsList
          chats={chats}
          activeId={conversationId}
          onOpen={openChat}
          onRename={rename}
          onDelete={remove}
        />
      </div>
      <SourcesPanel docs={docs} excluded={excluded} onToggle={toggle} />
    </div>
  );

  return (
    // Full screen height minus the 3.5rem (h-14) nav bar, so the text box stays visible.
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl">
      {/* Chats + sources: a sidebar on wide screens... */}
      <aside aria-label="Your sources" className="hidden w-72 shrink-0 flex-col border-r px-4 py-5 lg:flex">
        {panel}
      </aside>

      {/* ...and a slide-over on phones (a permanent side panel would squeeze the chat). */}
      {showPanel && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Chats and sources">
          <button
            aria-label="Close panel"
            onClick={() => setShowPanel(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-3 border-r bg-background px-4 py-5 shadow-xl">
            <button
              onClick={() => setShowPanel(false)}
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
            <h1 className="truncate text-2xl font-semibold">
              {chats?.find((c) => c.id === conversationId)?.title ?? "Chat"}
            </h1>
            {readyDocs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Searching {selectedDocs.length} of {readyDocs.length}{" "}
                {readyDocs.length === 1 ? "document" : "documents"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowPanel(true)}
              className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted lg:hidden"
            >
              Chats & sources
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
            <div className="flex max-w-[92%] flex-col gap-2">
              {live && live.steps.length > 0 ? (
                <AgentSteps steps={live.steps} finished={false} />
              ) : (
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
              {live?.text && (
                <div
                  aria-label="Answer so far"
                  className="prose prose-sm max-w-none rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{live.text + " ▍"}</ReactMarkdown>
                </div>
              )}
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
