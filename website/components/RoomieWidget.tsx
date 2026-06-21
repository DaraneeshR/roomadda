"use client";

import { useState, type FormEvent } from "react";

interface Message {
  role: "user" | "bot";
  text: string;
}

const GREETING: Message = {
  role: "bot",
  text: "Hi! I'm Roomie. Ask me to find PGs by city, budget or sharing type. Please don't share personal details here.",
};

export function RoomieWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/roomie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 429) {
        setMessages((m) => [...m, { role: "bot", text: "You're sending messages too fast — please wait a moment." }]);
        return;
      }
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "bot", text: data.reply ?? "Sorry, I couldn't respond right now." }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Network error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-96 w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between bg-teal-600 px-4 py-3 text-white">
            <span className="font-semibold">Roomie</span>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-white/90 hover:text-white">
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-2">
            <input
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              placeholder="Ask Roomie…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={1000}
            />
            <button type="submit" disabled={busy} className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              Send
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-teal-600 px-5 py-3 font-semibold text-white shadow-lg transition hover:bg-teal-700"
        aria-label="Open Roomie chat"
      >
        {open ? "Close" : "💬 Roomie"}
      </button>
    </>
  );
}
