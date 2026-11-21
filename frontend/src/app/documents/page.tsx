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
import StatusBadge from "@/components/StatusBadge";

export default function DocumentsPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null); // null = still loading
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState<File | null>(null); // chosen but not uploaded yet
  const [dragging, setDragging] = useState(false);

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
    if (!picked) return;
    setError("");
    setUploading(true);
    try {
      await uploadDocument(picked);
      setPicked(null);
      if (fileInput.current) fileInput.current.value = ""; // clear the picker
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) setPicked(file);
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">My documents</h1>
        <p className="mt-1 text-muted-foreground">
          Everything you upload here becomes searchable in the chat.
        </p>
      </div>

      <form onSubmit={handleUpload} className="flex flex-col gap-3">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragging ? "border-brand bg-accent" : "border-input bg-card hover:border-brand hover:bg-accent/50"
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-xl">⬆️</span>
          <span className="font-semibold">
            {picked ? picked.name : "Drop a file here, or click to choose"}
          </span>
          <span className="text-xs text-muted-foreground">PDF, Word (.docx), .txt or .md — up to 20 MB</span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="sr-only"
            onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          disabled={uploading || !picked}
          className="self-end rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {docs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No documents yet. Upload one above.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card shadow-sm">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-4 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground uppercase">
                {doc.filename.split(".").pop()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.filename}</p>
                <StatusBadge doc={doc} />
              </div>
              <button
                onClick={() => handleDelete(doc)}
                className="rounded-md px-2.5 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
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
