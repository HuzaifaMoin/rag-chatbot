import Link from "next/link";

// Next.js shows this page for any address that doesn't exist.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-zinc-500">That page doesn&apos;t exist.</p>
      <Link href="/" className="underline">
        Go home
      </Link>
    </main>
  );
}
