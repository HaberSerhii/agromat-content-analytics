"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// The refreshed product-card dashboard is the production default. The legacy
// catalog remains available only as an explicit rollback while real-data
// validation is in progress; it is not rendered or loaded otherwise.
const ProductCardsDashboardV2 = dynamic(
  () =>
    import("@/components/ProductCardsDashboardV2").then(
      (m) => m.ProductCardsDashboardV2,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="text-xs py-6 text-center"
        style={{ color: "var(--text-dim)" }}
      >
        Завантаження каталога…
      </div>
    ),
  },
);

const LegacyProductsCatalog = dynamic(
  () => import("@/components/ProductsCatalog").then((m) => m.ProductsCatalog),
  {
    ssr: false,
    loading: () => (
      <div
        className="text-xs py-6 text-center"
        style={{ color: "var(--text-dim)" }}
      >
        Завантаження каталога…
      </div>
    ),
  },
);

const ProductCardsDashboard =
  process.env.NEXT_PUBLIC_PRODUCT_CARDS_DASHBOARD === "legacy"
    ? LegacyProductsCatalog
    : ProductCardsDashboardV2;

const SalesDashboard = dynamic(
  () => import("@/components/SalesDashboard").then((m) => m.SalesDashboard),
  {
    ssr: false,
    loading: () => (
      <div
        className="text-xs py-6 text-center"
        style={{ color: "var(--text-dim)" }}
      >
        Завантаження продажів…
      </div>
    ),
  },
);

const PromotionsDashboard = dynamic(
  () =>
    import("@/components/PromotionsDashboard").then(
      (m) => m.PromotionsDashboard,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="text-xs py-6 text-center"
        style={{ color: "var(--text-dim)" }}
      >
        Завантаження акційних пропозицій…
      </div>
    ),
  },
);

const CompetitorDashboard = dynamic(
  () =>
    import("@/components/CompetitorDashboardV2").then(
      (m) => m.CompetitorDashboardV2,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="text-xs py-6 text-center"
        style={{ color: "var(--text-dim)" }}
      >
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
          <ProductCardsDashboard />
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
