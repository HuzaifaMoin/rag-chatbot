import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import type { DocumentItem } from "@/lib/api";

// The list of the user's documents with checkboxes (like NotebookLM's sources panel).
// Used in the desktop sidebar and in the slide-over panel on phones.
export default function SourcesPanel({
  docs,
  excluded,
  onToggle,
}: {
  docs: DocumentItem[] | null;
  excluded: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your sources</h2>
        <Link href="/documents" className="text-xs font-medium text-primary-ink hover:underline">
          Manage
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">Untick a document to leave it out of the answers.</p>
      {docs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <Link
          href="/documents"
          className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground hover:border-brand hover:text-foreground"
        >
          No documents yet.
          <br />
          <span className="font-medium text-primary-ink">Upload one →</span>
        </Link>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {docs.map((doc) => (
            <li key={doc.id}>
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted ${
                  doc.status !== "ready" ? "cursor-default opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--primary)]"
                  checked={doc.status === "ready" && !excluded.has(doc.id)}
                  disabled={doc.status !== "ready"}
                  onChange={() => onToggle(doc.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{doc.filename}</span>
                  <StatusBadge doc={doc} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
