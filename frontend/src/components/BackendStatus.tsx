"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

type Status = "checking" | "connected" | "offline";

export default function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((response) => response.json())
      .then((data) => setStatus(data.status === "ok" ? "connected" : "offline"))
      .catch(() => setStatus("offline"));
  }, []);

  if (status === "checking") {
    return <p className="text-sm text-zinc-500">🟡 Checking backend…</p>;
  }
  if (status === "connected") {
    return <p className="text-sm text-green-600">✅ Backend connected</p>;
  }
  return <p className="text-sm text-red-600">❌ Backend not reachable</p>;
}
