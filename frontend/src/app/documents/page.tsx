"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  UnauthorizedError,
  type DocumentItem,
} from "@/lib/api";

export default function DocumentsPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null); // null = still loading
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  // One place to handle errors: 401 means "go log in", anything else is shown in red.
  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) router.push("/login");
      else setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [router],
  );

  const load = useCallback(() => {
    listDocuments().then(setDocs).catch(handleError);
  }, [handleError]);

  // Load the list once when the page opens.
  useEffect(() => {
    load();
  }, [load]);

  // Polling: while any document is still processing, ask again in 2 seconds.
  useEffect(() => {
    if (!docs?.some((doc) => doc.status === "processing")) return;
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer); // cleanup: cancel the timer if we leave the page
  }, [docs, load]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      await uploadDocument(file);
      if (fileInput.current) fileInput.current.value = ""; // clear the picker
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: DocumentItem) {
    if (!confirm(`Delete ${doc.filename}?`)) return;
    setError("");
    try {
      await deleteDocument(doc.id);
      load();
    } catch (err) {
      handleError(err);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-3xl font-bold">My documents</h1>

      <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          required
          className="text-sm"
        />
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      <p className="-mt-4 text-xs text-zinc-500">PDF, Word (.docx), .txt or .md — up to 20 MB</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {docs === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-zinc-500">No documents yet. Upload one above.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.filename}</p>
                <StatusBadge doc={doc} />
              </div>
              <button
                onClick={() => handleDelete(doc)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// A small component with props: it gets one document and shows its status.
function StatusBadge({ doc }: { doc: DocumentItem }) {
  if (doc.status === "processing") {
    return <p className="text-xs text-yellow-600">🟡 Processing…</p>;
  }
  if (doc.status === "ready") {
    return (
      <p className="text-xs text-green-600">
        ✅ Ready · {doc.num_chunks} {doc.num_chunks === 1 ? "chunk" : "chunks"}
      </p>
    );
  }
  return <p className="text-xs text-red-600">❌ Failed: {doc.error ?? "unknown error"}</p>;
}
