"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { saveToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); // stop the browser from reloading the page
    setError("");
    setLoading(true);
    try {
      const token =
        mode === "login" ? await login(email, password) : await register(email, password);
      saveToken(token);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-center text-3xl font-bold">
          {isLogin ? "Log in" : "Create an account"}
        </h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <input
          type="password"
          placeholder={isLogin ? "Password" : "Password (at least 8 characters)"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? "Please wait…" : isLogin ? "Log in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(isLogin ? "signup" : "login");
            setError("");
          }}
          className="text-sm text-zinc-600 underline dark:text-zinc-400"
        >
          {isLogin ? "No account? Sign up" : "Have an account? Log in"}
        </button>
      </form>
    </main>
  );
}
