"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Heavy catalog component (≈2.4K lines + xlsx, etc.) — loaded on demand.
// Until the user opens tab 2, none of its JS ships. `ssr: false` keeps it out
// of the server render so the initial HTML is the lean shell + iframe.
const ProductsCatalog = dynamic(
  () => import("@/components/ProductsCatalog").then((m) => m.ProductsCatalog),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження каталога…
      </div>
    ),
  },
);

const SalesDashboard = dynamic(
  () => import("@/components/SalesDashboard").then((m) => m.SalesDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження продажів…
      </div>
    ),
  },
);

// Default points at the production same-origin nginx location
// (`/parcer/` → parser UI). In local Next dev, that path belongs to this app
// unless the parser URL is explicitly configured, so we show a small placeholder
// instead of recursively iframing the dashboard.
const PARCER_URL = process.env.NEXT_PUBLIC_PARCER_URL || "/parcer/";
const LOCAL_PARCER_URL = "http://127.0.0.1:5001/";

// Renders both tabs in a single persistent shell hosted by the root layout.
// CSS visibility swaps based on pathname → iframe and catalog stay mounted
// across tab switches, so neither pays its (slow) first-load cost twice.
//
// The catalog is mounted lazily on its first visit — until then, neither its
// JS nor its API requests fire.
export function AppShell() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [parserFrameReady, setParserFrameReady] = useState(false);
  const isCompetitors = pathname === "/";
  const isCatalog = pathname === "/catalog";
  const isSales = pathname === "/sales";
  const [isLocalHost, setIsLocalHost] = useState(
    () => typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"),
  );
  useEffect(() => {
    setMounted(true);
    setIsLocalHost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);
  const parserUrl = process.env.NEXT_PUBLIC_PARCER_URL || (isLocalHost ? LOCAL_PARCER_URL : PARCER_URL);

  useEffect(() => {
    if (!isCompetitors || !parserUrl) {
      setParserFrameReady(false);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    timeoutId = setTimeout(() => setParserFrameReady(true), 1200);
    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [isCompetitors, parserUrl]);

  // Sticky: once /catalog has been visited, keep ProductsCatalog mounted so
  // returning to it is instant (filters/state survive too).
  const [catalogVisited, setCatalogVisited] = useState(isCatalog);
  const [salesVisited, setSalesVisited] = useState(isSales);
  useEffect(() => {
    if (isCatalog) setCatalogVisited(true);
  }, [isCatalog]);
  useEffect(() => {
    if (isSales) setSalesVisited(true);
  }, [isSales]);

  if (!mounted) {
    return null;
  }

  return (
    <>
      {parserUrl && (
        <div
          className="rounded-2xl overflow-hidden border"
          style={{
            display: isCompetitors ? "block" : "none",
            borderColor: "var(--border)",
            background: "var(--bg-card)",
            boxShadow: "var(--shadow-sm)",
            height: "calc(100vh - 90px)",
          }}
        >
          {parserFrameReady ? (
            <iframe
              src={parserUrl}
              title="Аналіз цін конкурентів"
              loading="lazy"
              className="w-full h-full block"
              style={{ border: 0 }}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-white">
              <div className="text-sm font-semibold" style={{ color: "var(--text-dim)" }}>
                Завантаження аналізу цін…
              </div>
            </div>
          )}
        </div>
      )}

      {isCompetitors && !parserUrl && (
        <div
          className="rounded-2xl border p-6"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-card)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
            Основний дашборд парсера цін не підключений локально
          </div>
          <div className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>
            Для цієї вкладки потрібен зовнішній Flask/parser UI через <b>NEXT_PUBLIC_PARCER_URL</b>.
            Дані Plitka.ua і LeoCeramika вже завантажені в Supabase; дивись їх у вкладці
            <b> Аналіз карток товара → Ціни конкурентів</b>.
          </div>
        </div>
      )}

      {catalogVisited && (
        <div style={{ display: isCatalog ? "block" : "none" }}>
          <ProductsCatalog />
        </div>
      )}

      {salesVisited && (
        <div style={{ display: isSales ? "block" : "none" }}>
          <SalesDashboard />
        </div>
      )}
    </>
  );
}
