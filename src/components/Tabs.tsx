"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/",         label: "Аналіз цін конкурентів" },
  { href: "/catalog",  label: "Аналіз карток товара" },
  { href: "/sales",    label: "Аналіз продаж" },
];

export function Tabs() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return (
    <nav className="flex gap-1 rounded-xl p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
      {TABS.map((t) => {
        const active = mounted && pathname === t.href;
        return (
          <Link key={t.href} href={t.href}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold no-underline"
            style={active
              ? { background: "#118dff", color: "#fff" }
              : { background: "transparent", color: "var(--text-dim)" }}
          >{t.label}</Link>
        );
      })}
    </nav>
  );
}
