import Link from "next/link";

// Next.js shows this page for any address that doesn't exist.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-heading text-6xl font-semibold text-brand">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90"
      >
        Go home
      </Link>
    </main>
  );
}
