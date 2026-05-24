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

const PARCER_URL = process.env.NEXT_PUBLIC_PARCER_URL || "http://91.239.233.125:8080/";

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

  // Sticky: once /catalog has been visited, keep ProductsCatalog mounted so
  // returning to it is instant (filters/state survive too).
  const [catalogVisited, setCatalogVisited] = useState(isCatalog);
  useEffect(() => {
    if (isCatalog) setCatalogVisited(true);
  }, [isCatalog]);

  return (
    <>
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
        <iframe
          src={PARCER_URL}
          title="Аналіз цін конкурентів"
          className="w-full h-full block"
          style={{ border: 0 }}
        />
      </div>

      {catalogVisited && (
        <div style={{ display: isCatalog ? "block" : "none" }}>
          <ProductsCatalog />
        </div>
      )}
    </>
  );
}
