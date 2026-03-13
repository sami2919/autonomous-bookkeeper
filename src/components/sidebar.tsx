"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BookOpen,
  MessageSquare,
  BarChart3,
} from "lucide-react";

const navItems = [
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/ledger", label: "Ledger", icon: BookOpen },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex h-full w-64 flex-col border-r border-slate-200 bg-white"
    >
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <Link
          href="/transactions"
          className="text-sm font-semibold tracking-tight text-slate-900 hover:text-slate-600 transition-colors"
        >
          AI Bookkeeper
        </Link>
      </div>
      <nav
        aria-label="Main navigation"
        className="flex flex-1 flex-col gap-0.5 p-3"
      >
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={[
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              ].join(" ")}
            >
              <Icon
                size={20}
                className={isActive ? "text-blue-600" : "text-slate-400"}
                aria-hidden="true"
              />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
