import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { Tabs } from "@/components/Tabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agromat Content Analytics",
  description: "Аналіз цін конкурентів + аналіз карток товара",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        {/* Overlap DNS+TCP with HTML parse for the slowest origins. */}
        {process.env.UPSTASH_REDIS_REST_URL && (
          <link rel="preconnect" href={new URL(process.env.UPSTASH_REDIS_REST_URL).origin} crossOrigin="anonymous" />
        )}
        <link rel="preconnect" href="https://images-shop.agromat.ua" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.agromat.ua" crossOrigin="anonymous" />
      </head>
      <body>
        <div className="min-h-screen px-2 py-2 sm:px-4 sm:py-4">
          <header className="mb-3 flex min-w-0 flex-col gap-2 sm:mb-4 lg:flex-row lg:items-center lg:justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element -- external SVG logo is tiny and should load directly from the source */}
            <img
              src="https://www.agromat.ua/img/components/logo.svg"
              alt="Agromat"
              className="block h-7 self-start sm:h-9"
              style={{ filter: "brightness(0) saturate(100%) invert(20%) sepia(100%) saturate(2800%) hue-rotate(185deg) brightness(90%)" }}
            />
            <Tabs />
          </header>
          <main>
            {/* AppShell is rendered by the layout (not via `children`) so it
                survives navigation between / and /catalog. Page components are
                empty route markers — see src/app/page.tsx + catalog/page.tsx. */}
            <AppShell />
            {/* Route children are still rendered for Next.js routing semantics
                (page-level metadata, error boundaries) but visually hidden. */}
            <div style={{ display: "none" }}>{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
