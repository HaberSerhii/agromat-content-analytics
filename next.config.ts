import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone build → smaller production bundle, easier deploy on PM2.
  // Outputs to .next/standalone/ which we run with `node server.js`.
  output: "standalone",
  // Allow images from Agromat CDN (product photos in drill-down modal)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images-shop.agromat.ua" },
      { protocol: "https", hostname: "www.agromat.ua" },
    ],
  },
};

export default config;
