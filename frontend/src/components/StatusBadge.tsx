import type { DocumentItem } from "@/lib/api";

// A document's processing status. Colours carry meaning: amber = working, green = ready, red = failed.
export default function StatusBadge({ doc }: { doc: DocumentItem }) {
  if (doc.status === "processing") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-warning">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" aria-hidden="true" />
        Processing…
      </p>
    );
  }
  if (doc.status === "ready") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        Ready · {doc.num_chunks} {doc.num_chunks === 1 ? "chunk" : "chunks"}
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
      Failed: {doc.error ?? "unknown error"}
    </p>
  );
}
