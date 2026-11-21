import Link from "next/link";
import BackendStatus from "@/components/BackendStatus";

const FEATURES = [
  {
    icon: "📄",
    title: "Answers with citations",
    text: "Hybrid search (keywords + meaning) and a reranker find the right passages. Every claim links back to its source.",
  },
  {
    icon: "🛡️",
    title: "Guardrails",
    text: "Blocks prompt-injection attempts and checks each answer against the sources to catch hallucinations.",
  },
  {
    icon: "🌐",
    title: "Agentic fallback",
    text: "When your documents don't cover a question, an agent uses web search or a calculator, and says so.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-12 px-4 py-16 text-center">
      <section className="flex flex-col items-center gap-4">
        <h1 className="text-4xl font-bold sm:text-5xl">Chat with your documents</h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Upload PDFs, Word files or notes and ask questions. Every answer cites its sources, so you
          can check it.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="rounded bg-zinc-900 px-5 py-2.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Get started
          </Link>
          <Link
            href="/chat"
            className="rounded border border-zinc-300 px-5 py-2.5 font-medium dark:border-zinc-700"
          >
            Open chat
          </Link>
        </div>
      </section>

      <section className="grid w-full gap-4 text-left sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <p className="text-2xl">{feature.icon}</p>
            <h2 className="mt-2 font-semibold">{feature.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{feature.text}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto flex flex-col items-center gap-2 text-sm text-zinc-500">
        <BackendStatus />
        <p>
          Built by Huzaifa Moin ·{" "}
          <a
            href="https://github.com/HuzaifaMoin/rag-chatbot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Source on GitHub
          </a>
        </p>
      </footer>
    </main>
  );
}
