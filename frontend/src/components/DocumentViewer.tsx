"use client";

import { useEffect, useRef, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { getDocumentText, type DocumentChunk, type DocumentItem } from "@/lib/api";

// What to show: a document, and optionally the passage to jump to and highlight.
export type ViewerTarget = { documentId: string; chunkId?: string | null };

type Loaded = { document: DocumentItem; chunks: DocumentChunk[] };

// Documents already fetched while this page is open (so reopening is instant).
const cache = new Map<string, Loaded>();

// A panel that slides in from the right with the document's text, passage by passage.
// The original files aren't stored, so this shows the extracted text (same for PDF, Word, txt, md).
export default function DocumentViewer({
  target,
  onClose,
}: {
  target: ViewerTarget;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(() => cache.get(target.documentId) ?? null);
  const [error, setError] = useState("");
  const highlightRef = useRef<HTMLElement>(null);

  // Fetch the document's text (unless it's cached).
  useEffect(() => {
    const cached = cache.get(target.documentId);
    const request = cached ? Promise.resolve(cached) : getDocumentText(target.documentId);
    let cancelled = false;
    request
      .then((data) => {
        cache.set(target.documentId, data);
        if (!cancelled) setLoaded(data);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load it"));
    return () => {
      cancelled = true;
    };
  }, [target.documentId]);

  // Once the text is on screen, scroll the cited passage into view.
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [loaded, target.chunkId]);

  // Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doc = loaded?.document.id === target.documentId ? loaded : null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Document viewer">
      <button aria-label="Close document" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 right-0 flex w-[min(40rem,100vw)] flex-col border-l bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{doc?.document.filename ?? "Loading…"}</h2>
            {doc && (
              <div className="flex items-center gap-2">
                <StatusBadge doc={doc.document} />
                <span className="text-xs text-muted-foreground">
                  · {doc.chunks.length} {doc.chunks.length === 1 ? "passage" : "passages"}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            Close ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : !doc ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : doc.chunks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No text yet (still processing, or none found).</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {doc.chunks.map((chunk, i) => {
                const cited = chunk.id === target.chunkId;
                const newPage = chunk.page !== null && chunk.page !== doc.chunks[i - 1]?.page;
                return (
                  <li key={chunk.id}>
                    {newPage && (
                      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Page {chunk.page}
                      </p>
                    )}
                    <article
                      ref={cited ? highlightRef : undefined}
                      aria-current={cited ? "true" : undefined}
                      className={`rounded-xl border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        cited ? "border-brand bg-accent ring-2 ring-ring/30" : "bg-card"
                      }`}
                    >
                      {cited && (
                        <span className="mb-1.5 block text-xs font-semibold text-accent-foreground">
                          Cited passage
                        </span>
                      )}
                      {chunk.content}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
