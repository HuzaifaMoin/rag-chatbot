"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";

const LINKS = [
  { href: "/documents", label: "Documents" },
  { href: "/chat", label: "Chat" },
];

// A small mark: a page with a speech bubble (our own, not the Zerobounds logo).
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <path d="M10 8h8l4 4v8a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="#fff" opacity="0.95" />
      <path d="M11.5 14h7M11.5 17h5" stroke="#e1603e" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="22.5" cy="22.5" r="5" fill="#fff" />
      <path d="M20.5 22.5h4" stroke="#e1603e" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname(); // the current address, e.g. "/chat"
  const router = useRouter();
  // undefined = still checking, null = logged out, a string = the user's email
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  // Ask "who am I?" every time the address changes. The nav bar stays on screen
  // between pages, so this is how it notices you just logged in.
  useEffect(() => {
    fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((user) => setEmail(user ? user.email : null))
      .catch(() => setEmail(null));
  }, [pathname]);

  function logout() {
    clearToken();
    setEmail(null);
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-20 h-14 shrink-0 border-b bg-background/85 backdrop-blur">
      <nav className="mx-auto flex h-full max-w-6xl items-center gap-1 px-4 text-sm">
        <Link href="/" className="mr-4 flex items-center gap-2">
          <LogoMark />
          <span className="font-heading text-lg font-semibold tracking-tight">RAG Chatbot</span>
        </Link>

        {email &&
          LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                pathname === link.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}

        <div className="ml-auto flex items-center gap-3">
          {email && (
            <>
              <span className="hidden text-muted-foreground sm:inline">{email}</span>
              <button
                onClick={logout}
                className="rounded-md border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-muted"
              >
                Log out
              </button>
            </>
          )}
          {email === null && pathname !== "/login" && (
            <Link
              href="/login"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Log in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
