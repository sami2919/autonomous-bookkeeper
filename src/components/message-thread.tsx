"use client";

import { useEffect, useRef } from "react";
import { Send } from "lucide-react";

export type Message = {
  id: number;
  transactionId: number;
  direction: "agent" | "customer";
  content: string;
  createdAt: string;
};

type Props = {
  messages: Message[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function MessageThread({
  messages,
  draft,
  onDraftChange,
  onSend,
  sending,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when a new message arrives or the thread switches.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !sending) onSend();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Message history"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            No messages yet.
          </p>
        )}
        {messages.map((msg) => {
          const isAgent = msg.direction === "agent";
          return (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${isAgent ? "items-start" : "items-end"}`}
            >
              <div
                className={[
                  "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isAgent
                    ? "rounded-bl-md bg-slate-100 text-slate-800"
                    : "rounded-br-md bg-blue-600 text-white",
                ].join(" ")}
              >
                {msg.content}
              </div>
              <span className="px-1 text-[11px] text-slate-400">
                {isAgent ? "AI Bookkeeper" : "You"} · {formatTime(msg.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply... (Enter to send)"
            rows={2}
            aria-label="Reply message"
            maxLength={5000}
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 transition-colors"
            disabled={sending}
          />
          <button
            onClick={onSend}
            disabled={!draft.trim() || sending}
            className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            aria-label="Send message"
          >
            <Send size={14} aria-hidden="true" />
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        {draft.length > 4500 && (
          <p className="mt-1 text-right text-[11px] text-slate-400">
            {draft.length}/5000
          </p>
        )}
      </div>
    </div>
  );
}
