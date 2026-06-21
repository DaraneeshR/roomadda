export type ToastSeverity = "error" | "success" | "info" | "warning";

export interface ToastMessage {
  id: number;
  message: string;
  severity: ToastSeverity;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let counter = 0;

/** Emit a toast from anywhere (incl. outside React, e.g. query error handlers). */
export function pushToast(message: string, severity: ToastSeverity = "error"): void {
  counter += 1;
  const toast: ToastMessage = { id: counter, message, severity };
  for (const listener of listeners) listener(toast);
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
