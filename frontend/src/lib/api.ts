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
};

export async function sendChat(
  message: string,
  history: ChatTurn[],
  threadId: string | null,
  documentIds: string[] | null = null, // null = search all your documents
): Promise<ChatResponse> {
  const response = await authFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, thread_id: threadId, document_ids: documentIds }),
  });
  return response.json();
}

// Rate an answer: 1 = 👍, 0 = 👎. Voting again changes the vote.
export async function sendFeedback(runId: string, score: 0 | 1): Promise<void> {
  await authFetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, score }),
  });
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
