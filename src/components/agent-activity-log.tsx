"use client";

import { useRef, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import type { ActivityEvent } from "@/lib/types";

const AGENT_LABEL: Record<ActivityEvent["agent"], string> = {
  categorization: "Categorization",
  comms: "Comms",
};

const AGENT_COLOR: Record<ActivityEvent["agent"], string> = {
  categorization: "text-blue-400",
  comms: "text-emerald-400",
};

const AGENT_DOT: Record<ActivityEvent["agent"], string> = {
  categorization: "bg-blue-400",
  comms: "bg-emerald-400",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface AgentActivityLogProps {
  events: ActivityEvent[];
  active?: boolean;
}

export default function AgentActivityLog({
  events,
  active = false,
}: AgentActivityLogProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, collapsed]);

  const hasEvents = events.length > 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl shadow-lg shadow-black/20 border border-slate-700"
      role="log"
      aria-label="Agent activity log"
      aria-live="polite"
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between rounded-t-xl bg-slate-900 px-3 py-2.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-expanded={!collapsed}
        aria-controls="activity-log-body"
      >
        <div className="flex items-center gap-2">
          {active ? (
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
          ) : (
            <Activity size={14} className={hasEvents ? "text-emerald-400" : "text-slate-600"} aria-hidden="true" />
          )}
          <span className="text-xs font-medium text-white">Agent Activity</span>
          {hasEvents && (
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
              {events.length}
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronUp size={14} className="text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronDown size={14} className="text-slate-400" aria-hidden="true" />
        )}
      </button>

      {!collapsed && (
        <div
          id="activity-log-body"
          ref={scrollRef}
          className="max-h-64 overflow-y-auto rounded-b-xl bg-slate-950"
        >
          {!hasEvents ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">
              No activity yet. Click &ldquo;Process All&rdquo; to start.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {events.map((event, i) => (
                <li key={`${event.timestamp}-${event.agent}-${i}`} className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${AGENT_DOT[event.agent]}`}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-xs font-semibold ${AGENT_COLOR[event.agent]}`}
                    >
                      {AGENT_LABEL[event.agent]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
                    {event.message}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatTime(event.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
