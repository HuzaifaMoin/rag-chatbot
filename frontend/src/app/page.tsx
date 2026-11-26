import Link from "next/link";
import BackendStatus from "@/components/BackendStatus";
import DemoButton from "@/components/DemoButton";

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

const STEPS = [
  { n: "1", title: "Upload", text: "PDF, Word, Markdown or text files." },
  { n: "2", title: "Ask", text: "Questions in plain language, with follow-ups." },
  { n: "3", title: "Check", text: "Hover a citation to see the exact passage." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 py-14 sm:py-20">
      <section className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col items-start gap-5">
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold tracking-wide text-accent-foreground uppercase">
            Retrieval-augmented generation
          </span>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Chat with your <span className="text-brand italic">documents</span>
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Upload PDFs, Word files or notes and ask questions. Every answer cites its sources, so
            you can check it.
          </p>
          <div className="flex flex-wrap gap-3">
            <DemoButton className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60">
              Try the demo, no sign-up
            </DemoButton>
            <Link
              href="/login"
              className="rounded-lg border bg-card px-5 py-2.5 font-semibold transition-colors hover:bg-muted"
            >
              Log in or sign up
            </Link>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            The demo opens a private guest account with a sample company handbook already
            uploaded. You get 15 questions, and the account is deleted after 24 hours.
          </p>
        </div>

        {/* A static preview of what a cited answer looks like. */}
        <div aria-hidden="true" className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex justify-end">
            <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              How many days of leave do I get?
            </p>
          </div>
          <div className="mt-4 rounded-2xl rounded-bl-md bg-muted px-4 py-3 text-sm">
            Full-time staff get <strong>24 days</strong> of paid leave a year
            <span className="mx-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
              1
            </span>
            , and up to 5 unused days carry over
            <span className="ml-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
              2
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-success-soft px-2.5 py-1 font-medium text-success">
              📄 From your documents
            </span>
            <span className="rounded-full border px-2.5 py-1 text-muted-foreground">
              handbook.pdf · p. 4
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border bg-card p-6 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-xl">
              {feature.icon}
            </span>
            <h2 className="mt-4 text-lg font-semibold">{feature.title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{feature.text}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white">
              {step.n}
            </span>
            <div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </div>
          </div>
        ))}
      </section>

      <footer className="mt-auto flex flex-col items-center gap-2 border-t pt-8 text-sm text-muted-foreground">
        <BackendStatus />
        <p>
          Built by Huzaifa Moin ·{" "}
          <a
            href="https://github.com/HuzaifaMoin/rag-chatbot"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-ink underline-offset-4 hover:underline"
          >
            Source on GitHub
          </a>
        </p>
      </footer>
    </main>
  );
}
