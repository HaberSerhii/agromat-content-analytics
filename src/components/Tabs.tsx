"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/",           label: "Аналіз цін конкурентів", shortLabel: "Ціни" },
  { href: "/catalog",    label: "Аналіз карток товара", shortLabel: "Картки" },
  { href: "/promotions", label: "Аналіз акційних пропозицій", shortLabel: "Акції" },
  { href: "/sales",      label: "Аналіз продаж", shortLabel: "Продажі" },
];

export function Tabs() {
  const pathname = usePathname();
  return (
    <nav
      className="grid w-full min-w-0 grid-cols-4 gap-1 rounded-xl p-0.5 lg:flex lg:w-auto"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}
    >
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link key={t.href} href={t.href}
            className="min-w-0 rounded-lg px-1.5 py-2 text-center text-[11px] font-semibold no-underline sm:px-3 sm:text-xs lg:whitespace-nowrap"
            style={active
              ? { background: "#118dff", color: "#fff" }
              : { background: "transparent", color: "var(--text-dim)" }}
          >
            <span className="sm:hidden">{t.shortLabel}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
