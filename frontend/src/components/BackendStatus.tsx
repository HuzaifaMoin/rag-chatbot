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

  const dot = { checking: "bg-warning", connected: "bg-success", offline: "bg-danger" }[status];
  const label = {
    checking: "Checking backend…",
    connected: "Backend connected",
    offline: "Backend not reachable",
  }[status];

  return (
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </p>
  );
}
