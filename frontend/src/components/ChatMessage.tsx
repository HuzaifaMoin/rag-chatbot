"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AgentSteps from "@/components/AgentSteps";
import type { ViewerTarget } from "@/components/DocumentViewer";
import { sendFeedback, type AgentStep, type ChatResponse, type Citation } from "@/lib/api";
import { toast } from "@/lib/toast";

// A message in the chat. Bot messages also carry the full backend response
// (source, citations...); user messages only have text.
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; response: ChatResponse; steps?: AgentStep[] };

// Label and colours for each possible "source" value (theme tokens from globals.css).
const SOURCE_BADGES: Record<ChatResponse["source"], { label: string; className: string }> = {
  documents: { label: "📄 From your documents", className: "bg-success-soft text-success" },
  web: { label: "🌐 Web search", className: "bg-info-soft text-info" },
  calculator: { label: "🧮 Calculator", className: "bg-violet-soft text-violet" },
  general: { label: "💬 General knowledge", className: "bg-muted text-muted-foreground" },
  none: { label: "🤷 Not found in your documents", className: "bg-warning-soft text-warning" },
  blocked: { label: "🛡️ Blocked by safety check", className: "bg-danger-soft text-danger" },
};

// "[1]" or "[2, W1]" in the answer -> markdown links "#cite-1", so we can render them as chips.
const CITATION_RE = /\[((?:W?\d+)(?:\s*,\s*W?\d+)*)\]/g;
function linkCitations(answer: string): string {
  return answer.replace(CITATION_RE, (_, group: string) =>
    group
      .split(",")
      .map((label) => `[${label.trim()}](#cite-${label.trim()})`)
      .join(""),
  );
}

function citationTitle(c: Citation): string {
  if (c.type === "web") return c.title ?? c.url ?? "Web result";
  return `${c.filename}${c.page ? ` · p. ${c.page}` : ""}`;
}

export default function ChatMessage({
  message,
  onRegenerate,
  onOpenDocument,
}: {
  message: Message;
  onRegenerate?: () => void; // only given for the latest answer
  onOpenDocument?: (target: ViewerTarget) => void; // "View in document" on source cards
}) {
  // Which citation was last clicked (its source card gets highlighted).
  const [active, setActive] = useState<string | null>(null);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 whitespace-pre-wrap text-primary-foreground shadow-sm">
          {message.content}
        </p>
      </div>
    );
  }

  const { response } = message;
  const badge = SOURCE_BADGES[response.source];
  const byLabel = new Map(response.citations.map((c) => [c.label, c]));
  const idPrefix = `msg-${response.run_id}`;

  function openCitation(label: string) {
    setActive(label);
    document.getElementById(`${idPrefix}-cite-${label}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }

  return (
    <div className="flex max-w-[92%] flex-col gap-2">
      {message.steps && (
        <AgentSteps steps={message.steps} finished seconds={response.latency_ms / 1000} />
      )}
      {/* Markdown -> real formatting. react-markdown ignores raw HTML, so planted <script> tags can't run. */}
      <div className="prose prose-sm max-w-none rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...props }) => {
              const label = href?.startsWith("#cite-") ? href.slice("#cite-".length) : null;
              const citation = label ? byLabel.get(label) : undefined;
              if (label && citation) {
                return <CitationChip citation={citation} onOpen={() => openCitation(label)} />;
              }
              return (
                <a href={href} {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {linkCitations(message.content)}
        </ReactMarkdown>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${badge.className}`}>{badge.label}</span>
        {response.grounded === false && (
          <span className="rounded-full bg-warning-soft px-2.5 py-1 text-warning">
            ⚠️ May not be fully supported by the sources
          </span>
        )}
        <span className="text-muted-foreground">{(response.latency_ms / 1000).toFixed(1)}s</span>
        <span className="ml-auto flex items-center gap-1">
          <CopyButton text={message.content} />
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              ↻ Regenerate
            </button>
          )}
        </span>
        <FeedbackButtons runId={response.run_id} />
      </div>

      {response.citations.length > 0 && (
        <ul aria-label="Sources for this answer" className="grid gap-2 sm:grid-cols-2">
          {response.citations.map((citation) => (
            <CitationItem
              key={citation.label}
              id={`${idPrefix}-cite-${citation.label}`}
              citation={citation}
              highlighted={active === citation.label}
              onOpenDocument={onOpenDocument}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// The little orange [1] chip inside the answer. Hover (or keyboard focus) shows the source;
// click scrolls to its card.
function CitationChip({ citation, onOpen }: { citation: Citation; onOpen: () => void }) {
  // The chat scrolls inside a box that clips anything sticking out, so the preview opens
  // towards the side with room: right or left of the chip, above or below it.
  const [place, setPlace] = useState({ x: "left-0", y: "bottom-full mb-2" });

  function measure(event: React.SyntheticEvent<HTMLElement>) {
    const chip = event.currentTarget.getBoundingClientRect();
    const box = event.currentTarget.closest(".overflow-y-auto")?.getBoundingClientRect();
    const left = box?.left ?? 0;
    const right = box?.right ?? window.innerWidth;
    const top = box?.top ?? 0;
    setPlace({
      x: chip.left - left > right - chip.right ? "right-0" : "left-0",
      y: chip.top - top < 170 ? "top-full mt-2" : "bottom-full mb-2",
    });
  }

  return (
    <span
      className="group relative inline-block align-baseline"
      onMouseEnter={measure}
      onFocus={measure}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Source ${citation.label}: ${citationTitle(citation)}`}
        className="mx-0.5 rounded-md bg-accent px-1.5 py-px text-[0.7rem] font-semibold text-accent-foreground no-underline transition-colors hover:bg-brand hover:text-white"
      >
        {citation.label}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute ${place.x} ${place.y} z-30 w-72 max-w-[80vw] rounded-lg border bg-card p-3 text-left text-xs leading-relaxed font-normal text-card-foreground opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100`}
      >
        <span className="mb-1 block font-semibold text-primary-ink">{citationTitle(citation)}</span>
        <span className="line-clamp-5 block text-muted-foreground">{citation.snippet}</span>
      </span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Couldn't copy (your browser blocked it)", "error");
    }
  }
  return (
    <button
      onClick={copy}
      className="rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Copy
    </button>
  );
}

// 👍 / 👎 under each answer. The vote is saved by the backend and attached to the answer's
// LangSmith trace. After a 👎 we ask "what was wrong?": that comment makes debugging much easier.
function FeedbackButtons({ runId }: { runId: string }) {
  const [vote, setVote] = useState<0 | 1 | null>(null);
  const [error, setError] = useState(false);
  const [askWhy, setAskWhy] = useState(false);
  const [reason, setReason] = useState("");

  async function rate(score: 0 | 1) {
    if (score === vote) return;
    const previous = vote;
    setVote(score); // highlight straight away...
    setError(false);
    setAskWhy(score === 0);
    try {
      await sendFeedback(runId, score);
    } catch {
      setVote(previous); // ...and undo it if saving failed
      setAskWhy(false);
      setError(true);
    }
  }

  async function sendReason(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    try {
      await sendFeedback(runId, 0, reason.trim());
      setAskWhy(false);
      toast("Thanks, that helps improve the answers");
    } catch {
      toast("Couldn't send your comment", "error");
    }
  }

  const base = "rounded-md px-1.5 py-0.5 transition";
  const off = "opacity-50 grayscale hover:opacity-100 hover:grayscale-0";
  const on = "bg-accent";

  return (
    <>
      <span className="flex items-center gap-1">
        {vote !== null && !error && !askWhy && (
          <span className="text-muted-foreground">Thanks for the feedback</span>
        )}
        {error && <span className="text-danger">Couldn&apos;t save</span>}
        <button
          onClick={() => rate(1)}
          aria-label="Good answer"
          aria-pressed={vote === 1}
          className={`${base} ${vote === 1 ? on : off}`}
        >
          👍
        </button>
        <button
          onClick={() => rate(0)}
          aria-label="Bad answer"
          aria-pressed={vote === 0}
          className={`${base} ${vote === 0 ? on : off}`}
        >
          👎
        </button>
      </span>
      {askWhy && (
        <form
          onSubmit={sendReason}
          onKeyDown={(e) => e.key === "Escape" && setAskWhy(false)}
          className="flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card p-2"
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            placeholder="What was wrong? (optional)"
            aria-label="What was wrong with this answer?"
            className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => setAskWhy(false)}
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
          >
            Skip
          </button>
          <button
            type="submit"
            disabled={!reason.trim()}
            className="rounded-md bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
    </>
  );
}

function CitationItem({
  id,
  citation,
  highlighted,
  onOpenDocument,
}: {
  id: string;
  citation: Citation;
  highlighted: boolean;
  onOpenDocument?: (target: ViewerTarget) => void;
}) {
  const documentId = citation.type === "document" ? citation.document_id : null;
  return (
    <li
      id={id}
      className={`rounded-xl border bg-card px-3 py-2.5 text-xs transition-shadow ${
        highlighted ? "border-brand ring-2 ring-ring/30" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-accent px-1.5 py-px font-semibold text-accent-foreground">
          {citation.label}
        </span>
        {citation.type === "web" && citation.url ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium text-primary-ink underline-offset-2 hover:underline"
          >
            {citationTitle(citation)}
          </a>
        ) : (
          <span className="truncate font-medium">{citationTitle(citation)}</span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-muted-foreground">{citation.snippet}</p>
      {documentId && onOpenDocument && (
        <button
          onClick={() => onOpenDocument({ documentId, chunkId: citation.chunk_id })}
          className="mt-2 font-medium text-primary-ink underline-offset-2 hover:underline"
        >
          View in document →
        </button>
      )}
    </li>
  );
}
