import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatResponse, Citation } from "@/lib/api";

// A message in the chat. Bot messages also carry the full backend response
// (source, citations...); user messages only have text.
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; response: ChatResponse };

// Text and colour for each possible "source" value.
const SOURCE_BADGES: Record<ChatResponse["source"], { label: string; className: string }> = {
  documents: { label: "📄 From your documents", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  web: { label: "🌐 Web search", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  calculator: { label: "🧮 Calculator", className: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300" },
  general: { label: "💬 General knowledge", className: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" },
  none: { label: "🤷 Not found in your documents", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300" },
  blocked: { label: "🛡️ Blocked by safety check", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

export default function ChatMessage({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
          {message.content}
        </p>
      </div>
    );
  }

  const { response } = message;
  const badge = SOURCE_BADGES[response.source];

  return (
    <div className="flex max-w-[90%] flex-col gap-2">
      {/* Markdown → real formatting. react-markdown ignores raw HTML, so planted <script> tags can't run. */}
      <div className="prose prose-sm max-w-none rounded-2xl bg-zinc-100 px-4 py-2 dark:prose-invert dark:bg-zinc-900">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${badge.className}`}>
          {badge.label}
        </span>
        {response.grounded === false && (
          <span className="text-yellow-700 dark:text-yellow-400">
            ⚠️ Answer may not be fully supported by the sources
          </span>
        )}
        <span className="text-zinc-500">{(response.latency_ms / 1000).toFixed(1)}s</span>
      </div>

      {response.citations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {response.citations.map((citation) => (
            <CitationItem key={citation.label} citation={citation} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CitationItem({ citation }: { citation: Citation }) {
  const title =
    citation.type === "web"
      ? citation.title ?? citation.url
      : `${citation.filename}${citation.page ? `, page ${citation.page}` : ""}`;

  return (
    <li className="rounded border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
      <span className="font-semibold">[{citation.label}] </span>
      {citation.type === "web" && citation.url ? (
        <a href={citation.url} target="_blank" rel="noopener noreferrer" className="underline">
          {title}
        </a>
      ) : (
        <span className="font-medium">{title}</span>
      )}
      <p className="mt-1 line-clamp-2 text-zinc-600 dark:text-zinc-400">{citation.snippet}</p>
    </li>
  );
}
