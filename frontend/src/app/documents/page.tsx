"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDocument,
  listDocuments,
  uploadDocumentWithProgress,
  UnauthorizedError,
  type DocumentItem,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import DocumentViewer, { type ViewerTarget } from "@/components/DocumentViewer";
import StatusBadge from "@/components/StatusBadge";

// A file being uploaded right now (before the backend has it).
type Upload = { key: number; name: string; progress: number; error?: string };

let nextKey = 1;

export default function DocumentsPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null); // null = still loading
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const closeViewer = useCallback(() => setViewer(null), []);

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

  function updateUpload(key: number, change: Partial<Upload>) {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...change } : u)));
  }

  // Upload every chosen file at once, each with its own progress bar.
  function startUploads(files: FileList | File[]) {
    setError("");
    for (const file of Array.from(files)) {
      const key = nextKey++;
      setUploads((prev) => [...prev, { key, name: file.name, progress: 0 }]);
      uploadDocumentWithProgress(file, (progress) => updateUpload(key, { progress }))
        .then(() => {
          setUploads((prev) => prev.filter((u) => u.key !== key));
          toast(`Uploaded ${file.name}`);
          load();
        })
        .catch((err) => {
          if (err instanceof UnauthorizedError) return router.push("/login");
          const message = err instanceof Error ? err.message : "Upload failed";
          updateUpload(key, { error: message });
          toast(`${file.name}: ${message}`, "error");
        });
    }
    if (fileInput.current) fileInput.current.value = ""; // so the same file can be picked again
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) startUploads(event.dataTransfer.files);
  }

  async function handleDelete(doc: DocumentItem) {
    if (!confirm(`Delete ${doc.filename}?`)) return;
    setError("");
    try {
      await deleteDocument(doc.id);
      toast(`Deleted ${doc.filename}`);
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
        <span className="font-semibold">Drop files here, or click to choose</span>
        <span className="text-xs text-muted-foreground">
          PDF, Word (.docx), .txt or .md — up to 20 MB each · several at once is fine
        </span>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          className="sr-only"
          onChange={(e) => e.target.files?.length && startUploads(e.target.files)}
        />
      </label>

      {uploads.length > 0 && (
        <ul aria-label="Uploads in progress" className="flex flex-col gap-2">
          {uploads.map((u) => (
            <li key={u.key} className="rounded-xl border bg-card px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{u.name}</span>
                {u.error ? (
                  <button
                    onClick={() => setUploads((prev) => prev.filter((x) => x.key !== u.key))}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground tabular-nums">{u.progress}%</span>
                )}
              </div>
              {u.error ? (
                <p className="mt-1 text-xs text-danger">{u.error}</p>
              ) : (
                <div
                  role="progressbar"
                  aria-valuenow={u.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Uploading ${u.name}`}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {viewer && <DocumentViewer target={viewer} onClose={closeViewer} />}

      {docs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No documents yet. Upload one above.
        </p>
      ) : (
        <ul aria-label="Your documents" className="flex flex-col divide-y rounded-xl border bg-card shadow-sm">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-4 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground uppercase">
                {doc.filename.split(".").pop()}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => setViewer({ documentId: doc.id })}
                  disabled={doc.status !== "ready"}
                  title={doc.status === "ready" ? "Read this document" : undefined}
                  className="block max-w-full truncate text-left font-medium underline-offset-2 enabled:hover:text-primary-ink enabled:hover:underline"
                >
                  {doc.filename}
                </button>
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
