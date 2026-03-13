"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import MessageThread, { type Message } from "@/components/message-thread";

type Transaction = {
  id: number;
  date: string;
  merchantName: string | null;
  description: string;
  amountCents: number;
  status: string;
};

type ApiResponse<T> = { data: T | null; error?: string };

function formatAmount(cents: number): string {
  const sign = cents < 0 ? "+" : "-";
  const abs = Math.abs(cents) / 100;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

async function fetchMessages(
  transactionId: number,
  signal?: AbortSignal
): Promise<Message[]> {
  const res = await fetch(`/api/messages?transactionId=${transactionId}`, {
    signal,
  });
  if (!res.ok) throw new Error("Failed to load messages");
  const json: ApiResponse<Message[]> = await res.json();
  if (!json.data) throw new Error(json.error ?? "Unknown error");
  return json.data;
}

async function sendMessage(
  transactionId: number,
  content: string
): Promise<void> {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, content }),
  });
  if (!res.ok) {
    let errorMsg = `Request failed (${res.status})`;
    try {
      const json = await res.json();
      errorMsg = json.error ?? errorMsg;
    } catch {
      // Non-JSON error body — use status-based message
    }
    throw new Error(errorMsg);
  }
}

function TransactionItem({
  tx,
  selected,
  onClick,
}: {
  tx: Transaction;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={[
        "w-full rounded-lg px-3 py-3 text-left transition-colors duration-150 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        selected
          ? "bg-blue-50 ring-1 ring-blue-200"
          : "hover:bg-slate-50",
      ].join(" ")}
    >
      <p className="truncate text-sm font-medium text-slate-900">
        {tx.merchantName ?? tx.description}
      </p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{formatDate(tx.date)}</span>
        <span
          className={[
            "text-xs font-medium font-mono tabular-nums",
            tx.amountCents < 0 ? "text-emerald-600" : "text-slate-700",
          ].join(" ")}
        >
          {formatAmount(tx.amountCents)}
        </span>
      </div>
    </button>
  );
}

function TransactionDetail({ tx }: { tx: Transaction }) {
  return (
    <div className="border-b border-slate-200 bg-blue-50 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {tx.merchantName ?? tx.description}
          </p>
          {tx.merchantName && (
            <p className="mt-0.5 text-xs text-slate-500">{tx.description}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">{formatDate(tx.date)}</p>
        </div>
        <span
          className={[
            "shrink-0 text-lg font-semibold font-mono tabular-nums",
            tx.amountCents < 0 ? "text-emerald-600" : "text-slate-900",
          ].join(" ")}
        >
          {formatAmount(tx.amountCents)}
        </span>
      </div>
      <div className="mt-2">
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
          Needs clarification
        </span>
      </div>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
      <div className="w-48 h-4 rounded bg-slate-200 animate-pulse" />
      <div className="w-36 h-4 rounded bg-slate-200 animate-pulse" />
      <div className="w-52 h-4 rounded bg-slate-200 animate-pulse" />
    </div>
  );
}

type Props = {
  initialTransactions: Transaction[];
};

export default function MessagesClient({ initialTransactions }: Props) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [msgLoading, setMsgLoading] = useState(false);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === null && transactions.length > 0) {
      setSelectedId(transactions[0].id);
    }
  }, [transactions, selectedId]);

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  const loadMessages = useCallback(async (transactionId: number) => {
    const controller = new AbortController();
    try {
      setMsgLoading(true);
      setMsgError(null);
      const data = await fetchMessages(transactionId, controller.signal);
      setMessages(data);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setMsgError(
        err instanceof Error ? err.message : "Failed to load messages"
      );
    } finally {
      setMsgLoading(false);
    }
    return controller;
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      return;
    }
    const controllerPromise = loadMessages(selectedId);
    return () => {
      controllerPromise.then((ctrl) => ctrl?.abort());
    };
  }, [selectedId, loadMessages]);

  async function handleSend() {
    if (!selectedId || !draft.trim() || sending) return;
    const capturedId = selectedId;
    const content = draft.trim();
    setSending(true);
    setDraft("");
    setMsgError(null);
    try {
      await sendMessage(capturedId, content);
      const refreshThread =
        selectedIdRef.current === capturedId
          ? loadMessages(capturedId)
          : Promise.resolve();
      await refreshThread;
      router.refresh();
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : "Failed to send");
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  const selectedTx = transactions.find((t) => t.id === selectedId) ?? null;

  if (transactions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <CheckCircle size={32} className="mx-auto text-emerald-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-slate-700">
            No transactions need clarification
          </p>
          <p className="mt-1 text-xs text-slate-400">
            All transactions have been resolved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-900">
            Needs Clarification
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {transactions.length}{" "}
            {transactions.length === 1 ? "transaction" : "transactions"}
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {transactions.map((tx) => (
            <TransactionItem
              key={tx.id}
              tx={tx}
              selected={tx.id === selectedId}
              onClick={() => setSelectedId(tx.id)}
            />
          ))}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        {selectedTx === null ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-slate-400">
              Select a transaction to view messages
            </p>
          </div>
        ) : (
          <>
            <TransactionDetail tx={selectedTx} />

            {msgError && (
              <div
                role="alert"
                className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600"
              >
                {msgError}
              </div>
            )}

            {msgLoading ? (
              <MessagesSkeleton />
            ) : (
              <MessageThread
                messages={messages}
                draft={draft}
                onDraftChange={setDraft}
                onSend={handleSend}
                sending={sending}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
