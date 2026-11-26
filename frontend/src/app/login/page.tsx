"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { LogoMark } from "@/components/NavBar";
import DemoButton from "@/components/DemoButton";

const INPUT =
  "rounded-lg border border-input bg-background px-3 py-2 font-normal outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border bg-card p-8 shadow-sm"
      >
        <div className="mb-2 flex flex-col items-center gap-3 text-center">
          <LogoMark className="h-10 w-10" />
          <h1 className="text-3xl font-semibold">{isLogin ? "Welcome back" : "Create an account"}</h1>
          <p className="text-sm text-muted-foreground">
            {isLogin ? "Log in to chat with your documents." : "Free, and takes ten seconds."}
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input
            type="password"
            placeholder={isLogin ? "Password" : "Password (at least 8 characters)"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={INPUT}
          />
        </label>

        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Please wait…" : isLogin ? "Log in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(isLogin ? "signup" : "login");
            setError("");
          }}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-primary-ink hover:underline"
        >
          {isLogin ? "No account? Sign up" : "Have an account? Log in"}
        </button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <DemoButton className="rounded-lg border bg-card px-3 py-2.5 font-semibold transition-colors hover:bg-muted disabled:opacity-60">
          Just looking? Try the demo
        </DemoButton>
      </form>
    </main>
  );
}
