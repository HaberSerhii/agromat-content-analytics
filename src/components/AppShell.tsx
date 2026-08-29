"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Heavy catalog component (≈2.4K lines + xlsx, etc.) — loaded on demand.
// Until the user opens tab 2, none of its JS ships. `ssr: false` keeps it out
// of the server render so the initial HTML stays lean.
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

const CompetitorDashboard = dynamic(
  () => import("@/components/CompetitorDashboardV2").then((m) => m.CompetitorDashboardV2),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження аналізу цін…
      </div>
    ),
  },
);

// Renders all sections in a single persistent shell hosted by the root layout.
// Heavy secondary dashboards stay mounted after their first visit so filters
// and already-loaded data survive tab switches.
//
// The catalog is mounted lazily on its first visit — until then, neither its
// JS nor its API requests fire.
export function AppShell() {
  const pathname = usePathname();
  const isCompetitors = pathname === "/";
  const isCatalog = pathname === "/catalog";
  const isPromotions = pathname === "/promotions";
  const isSales = pathname === "/sales";

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
      {isCompetitors && <CompetitorDashboard />}

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
    </>
  );
}
