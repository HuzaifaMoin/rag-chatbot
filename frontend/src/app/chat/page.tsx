"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import { authFetch, sendChat, UnauthorizedError, type ChatTurn } from "@/lib/api";

// The backend accepts up to 40 earlier turns; we send the most recent 20.
const MAX_HISTORY = 20;

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // When the page opens, check we're logged in; if not, go to the login page.
  useEffect(() => {
    authFetch("/api/auth/me").catch((err) => {
      if (err instanceof UnauthorizedError) router.push("/login");
    });
  }, [router]);

  // Whenever the message list changes, scroll so the newest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;

    // History = the conversation so far, without the backend's extra fields.
    const history: ChatTurn[] = messages
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await sendChat(question, history, threadId);
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
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col p-4">
      <header className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-2xl font-bold">Chat</h1>
        <button onClick={newChat} className="text-sm underline">
          New chat
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="m-auto text-center text-zinc-500">
            Ask anything about your documents.
            <br />
            Answers come with sources you can check.
          </p>
        )}
        {messages.map((message, index) => (
          <ChatMessage key={index} message={message} />
        ))}
        {loading && <p className="text-sm text-zinc-500">Thinking…</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="pb-2 text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
          rows={2}
          className="flex-1 resize-none rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="rounded bg-zinc-900 px-4 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Send
        </button>
      </div>
    </main>
  );
}
