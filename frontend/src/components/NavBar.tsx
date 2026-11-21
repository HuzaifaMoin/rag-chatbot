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
    <header className="h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex h-full max-w-5xl items-center gap-4 px-4 text-sm">
        <Link href="/" className="font-bold">
          RAG Chatbot
        </Link>

        {email &&
          LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname === link.href
                  ? "font-medium text-zinc-900 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }
            >
              {link.label}
            </Link>
          ))}

        <div className="ml-auto flex items-center gap-3">
          {email && (
            <>
              <span className="hidden text-zinc-500 sm:inline">{email}</span>
              <button onClick={logout} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">
                Log out
              </button>
            </>
          )}
          {email === null && pathname !== "/login" && (
            <Link href="/login" className="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900">
              Log in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
