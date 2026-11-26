"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startDemo } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { toast } from "@/lib/toast";

// "Try the demo": the backend makes a fresh guest account with a sample handbook,
// we keep its token like a normal login, and open the chat.
export default function DemoButton({
  className,
  children = "Try the demo",
}: {
  className: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    try {
      saveToken(await startDemo());
      localStorage.removeItem("rag_last_chat"); // a chat from another account won't open
      router.push("/chat");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start the demo", "error");
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={start} disabled={loading} className={className}>
      {loading ? "Setting up your demo…" : children}
    </button>
  );
}
