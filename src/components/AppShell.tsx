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

const PromotionsDashboard = dynamic(
  () => import("@/components/PromotionsDashboard").then((m) => m.PromotionsDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження акційних пропозицій…
      </div>
    ),
  },
);

const CompetitorDashboardV2 = dynamic(
  () => import("@/components/CompetitorDashboardV2").then((m) => m.CompetitorDashboardV2),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження тестового дашборда…
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
  const isCompetitors = pathname === "/";
  const isCatalog = pathname === "/catalog";
  const isPromotions = pathname === "/promotions";
  const isSales = pathname === "/sales";
  const isCompetitorsV2 = pathname === "/competitors-v2";
  // Keep the server and first client render identical so the visible parser
  // iframe can be emitted in the initial HTML instead of waiting for hydration.
  const [isLocalHost, setIsLocalHost] = useState(false);
  useEffect(() => {
    setIsLocalHost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);
  const parserUrl = process.env.NEXT_PUBLIC_PARCER_URL || (isLocalHost ? LOCAL_PARCER_URL : PARCER_URL);

  // Like the other dashboards, the parser is mounted only after its first
  // visit. Once mounted it stays alive across tab switches, preserving its
  // filters, scroll position and already-rendered report.
  const [competitorsVisited, setCompetitorsVisited] = useState(isCompetitors);
  const [parserFrameLoaded, setParserFrameLoaded] = useState(false);
  useEffect(() => {
    if (isCompetitors) setCompetitorsVisited(true);
  }, [isCompetitors]);

  useEffect(() => {
    setParserFrameLoaded(false);
  }, [parserUrl]);

  // Sticky: once /catalog has been visited, keep ProductsCatalog mounted so
  // returning to it is instant (filters/state survive too).
  const [catalogVisited, setCatalogVisited] = useState(isCatalog);
  const [promotionsVisited, setPromotionsVisited] = useState(isPromotions);
  const [salesVisited, setSalesVisited] = useState(isSales);
  useEffect(() => {
    if (isCatalog) setCatalogVisited(true);
  }, [isCatalog]);
  useEffect(() => {
    if (isPromotions) setPromotionsVisited(true);
  }, [isPromotions]);
  useEffect(() => {
    if (isSales) setSalesVisited(true);
  }, [isSales]);

  return (
    <>
      {parserUrl && competitorsVisited && (
        <div
          className="rounded-2xl overflow-hidden border"
          aria-busy={isCompetitors && !parserFrameLoaded}
          style={{
            display: isCompetitors ? "block" : "none",
            position: "relative",
            borderColor: "var(--border)",
            background: "var(--bg-card)",
            boxShadow: "var(--shadow-sm)",
            height: "calc(100dvh - 118px)",
          }}
        >
          <iframe
            src={parserUrl}
            title="Аналіз цін конкурентів"
            loading="eager"
            onLoad={() => setParserFrameLoaded(true)}
            className="w-full h-full block"
            style={{ border: 0 }}
          />
          {!parserFrameLoaded && isCompetitors && (
            <div
              className="absolute inset-0 flex h-full w-full items-center justify-center bg-white"
              role="status"
              aria-live="polite"
            >
              <div className="animate-pulse text-sm font-semibold" style={{ color: "var(--text-dim)" }}>
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

      {promotionsVisited && (
        <div style={{ display: isPromotions ? "block" : "none" }}>
          <PromotionsDashboard />
        </div>
      )}

      {salesVisited && (
        <div style={{ display: isSales ? "block" : "none" }}>
          <SalesDashboard />
        </div>
      )}

      {isCompetitorsV2 && <CompetitorDashboardV2 />}
    </>
  );
}
