// A tiny toast system (small pop-up messages). Any code can call toast("Copied"),
// and the <Toaster /> in the layout shows it for a few seconds.

export type Toast = { id: number; message: string; kind: "success" | "error" };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function toast(message: string, kind: Toast["kind"] = "success"): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => dismiss(id), 3500);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// For React's useSyncExternalStore: subscribe to changes and read the current list.
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Toast[] = [];
export const getToasts = () => toasts;
export const getServerToasts = () => EMPTY;
