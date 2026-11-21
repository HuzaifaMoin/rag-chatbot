"use client";

import { useSyncExternalStore } from "react";
import { dismiss, getServerToasts, getToasts, subscribe } from "@/lib/toast";

// Shows the toasts from lib/toast.ts in the bottom-right corner.
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getServerToasts);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg ${
            t.kind === "error" ? "border-danger/40" : ""
          }`}
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.kind === "error" ? "bg-danger" : "bg-success"}`}
            aria-hidden="true"
          />
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
