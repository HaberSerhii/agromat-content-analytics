import type { Metadata } from "next";
import { Tabs } from "@/components/Tabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agromat Content Analytics",
  description: "Аналіз цін конкурентів + аналіз карток товара",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <div className="min-h-screen px-4 py-4">
          <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <img
              src="https://www.agromat.ua/img/components/logo.svg"
              alt="Agromat"
              className="h-9 block"
              style={{ filter: "brightness(0) saturate(100%) invert(20%) sepia(100%) saturate(2800%) hue-rotate(185deg) brightness(90%)" }}
            />
            <Tabs />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
