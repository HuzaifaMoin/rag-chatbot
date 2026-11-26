import { getToken } from "@/lib/auth";

// The backend's address. It comes from .env.local, with a fallback for local dev.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Turns "/api/health" into "http://localhost:8000/api/health".
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// fetch, but with a friendly message when the server can't be reached at all
// (the browser's own message is just "Failed to fetch").
async function request(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(apiUrl(path), options);
  } catch {
    throw new Error("Can't reach the server. Please try again in a moment.");
  }
}

// FastAPI puts error text in "detail". It is a string ("Incorrect email or password"),
// or a list of problems when the data is invalid (e.g. a password that is too short).
async function errorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail) && data.detail.length > 0) return data.detail[0].msg;
  } catch {
    // The reply wasn't JSON. Fall through to the generic message.
  }
  return `Request failed (${response.status})`;
}

// Thrown when the backend says 401: no token, or it's expired/invalid.
export class UnauthorizedError extends Error {
  constructor() {
    super("Please log in again");
  }
}

// Like fetch, but adds "Authorization: Bearer <token>" and throws on any error reply.
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${getToken() ?? ""}`);
  const response = await request(path, { ...options, headers });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(await errorMessage(response));
  return response;
}

// The shape of one document, as the backend sends it.
export type DocumentItem = {
  id: string;
  filename: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  num_chunks: number;
  created_at: string;
};

export async function listDocuments(): Promise<DocumentItem[]> {
  const response = await authFetch("/api/documents");
  return response.json();
}

// Files can't go in JSON, so we send them as form data (multipart/form-data).
export async function uploadDocument(file: File): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);
  const response = await authFetch("/api/documents", { method: "POST", body: form });
  return response.json();
}

// A document's text for the viewer: its passages in reading order.
export type DocumentChunk = { id: string; chunk_index: number; page: number | null; content: string };

export async function getDocumentText(
  id: string,
): Promise<{ document: DocumentItem; chunks: DocumentChunk[] }> {
  return (await authFetch(`/api/documents/${id}/chunks`)).json();
}

// Same as uploadDocument, but reports progress (0-100). fetch can't report upload progress,
// so this uses the older XMLHttpRequest, which can.
export function uploadDocumentWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<DocumentItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/documents"));
    xhr.setRequestHeader("Authorization", `Bearer ${getToken() ?? ""}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new UnauthorizedError());
      let data: { detail?: unknown } & Partial<DocumentItem> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the generic message
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as DocumentItem);
      const detail = data.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail) && detail[0]?.msg
            ? detail[0].msg
            : `Upload failed (${xhr.status})`;
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Can't reach the server. Please try again in a moment."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await authFetch(`/api/documents/${id}`, { method: "DELETE" });
}

// ---- Chat ----

// One earlier message, sent back to the backend so it understands follow-up questions.
export type ChatTurn = { role: "user" | "assistant"; content: string };

// Where a piece of the answer came from: a chunk of your document, or a web page.
export type Citation = {
  label: string; // "1", "2"... for documents, "W1", "W2"... for web results
  type: "document" | "web";
  snippet: string;
  document_id?: string | null; // document citations: which document...
  chunk_id?: string | null; // ...and which passage in it (for the document viewer)
  filename: string | null;
  page: number | null;
  title: string | null;
  url: string | null;
};

export type ChatResponse = {
  answer: string;
  source: "documents" | "web" | "calculator" | "general" | "none" | "blocked";
  citations: Citation[];
  grounded: boolean | null;
  tools_used: string[];
  thread_id: string;
  run_id: string;
  latency_ms: number;
  conversation_id?: string | null; // the saved chat this answer belongs to
};

// What every chat request can carry besides the question.
export type ChatOptions = {
  conversationId: string | null; // continue a saved chat (null = start a new one)
  history: ChatTurn[]; // only used for a new chat; saved chats load their own history
  documentIds: string[] | null; // null = search all your documents
  replaceLast?: boolean; // Regenerate: replace the chat's last question + answer
};

function chatBody(message: string, o: ChatOptions): string {
  return JSON.stringify({
    message,
    history: o.history,
    conversation_id: o.conversationId,
    document_ids: o.documentIds,
    replace_last: o.replaceLast ?? false,
  });
}

export async function sendChat(message: string, options: ChatOptions): Promise<ChatResponse> {
  const response = await authFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: chatBody(message, options),
  });
  return response.json();
}

// ---- Streaming chat ----

// One step of the agent's work, e.g. "Searching your documents" -> "5 passages found".
export type AgentStep = {
  node: string;
  label: string;
  status: "running" | "done";
  detail?: string | null;
};

export type StreamHandlers = {
  onStep: (step: AgentStep) => void;
  onToken: (text: string) => void;
  onReset: () => void; // the agent threw its draft away (e.g. rewriting for accuracy)
};

// Thrown when the stream couldn't start at all, so the caller can fall back to /api/chat.
export class StreamUnavailableError extends Error {}

// Ask a question and receive the answer as it's being made (Server-Sent Events).
// The browser's EventSource only does GET, and we need POST, so we read the stream ourselves.
export async function streamChat(
  message: string,
  options: ChatOptions,
  handlers: StreamHandlers,
): Promise<ChatResponse> {
  let response: Response;
  try {
    response = await authFetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: chatBody(message, options),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new StreamUnavailableError(err instanceof Error ? err.message : "stream failed");
  }
  if (!response.body) throw new StreamUnavailableError("no stream body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line: "event: x\ndata: {...}\n\n"
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      const payload = data ? JSON.parse(data) : {};
      if (event === "step") handlers.onStep(payload as AgentStep);
      else if (event === "token") handlers.onToken(payload.text);
      else if (event === "reset") handlers.onReset();
      else if (event === "done") return payload as ChatResponse;
      else if (event === "error") throw new Error(payload.detail ?? "Something went wrong");
    }
  }
  throw new Error("The answer stream ended unexpectedly. Please try again.");
}

// Rate an answer: 1 = 👍, 0 = 👎, optionally with a comment. Voting again changes the vote.
export async function sendFeedback(runId: string, score: 0 | 1, comment?: string): Promise<void> {
  await authFetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, score, comment: comment || null }),
  });
}

// ---- Saved chats ----

export type ConversationSummary = { id: string; title: string; updated_at: string };

export type SavedMessage = {
  role: "user" | "assistant";
  content: string;
  response: (ChatResponse & { steps?: AgentStep[] }) | null;
};

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await authFetch("/api/conversations")).json();
}

export async function getConversation(
  id: string,
): Promise<ConversationSummary & { messages: SavedMessage[] }> {
  return (await authFetch(`/api/conversations/${id}`)).json();
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await authFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await authFetch(`/api/conversations/${id}`, { method: "DELETE" });
}

// ---- Auth ----

// Sign up. The backend wants JSON and replies with a token.
export async function register(email: string, password: string): Promise<string> {
  const response = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json();
  return data.access_token;
}

// Log in. The backend wants form data, with the email in a field called "username".
export async function login(email: string, password: string): Promise<string> {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: new URLSearchParams({ username: email, password }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json();
  return data.access_token;
}

// ---- "Try the demo" ----

// Only on guest accounts: when the demo account is deleted and how many questions are left.
export type GuestInfo = { expires_at: string; questions_left: number; question_limit: number };

export type Me = { id: string; email: string; guest: GuestInfo | null };

export async function getMe(): Promise<Me> {
  return (await authFetch("/api/auth/me")).json();
}

// Make a fresh guest account (the Northwind handbook is already in it) and return its token.
export async function startDemo(): Promise<string> {
  const response = await request("/api/auth/guest", { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json();
  return data.access_token;
}
