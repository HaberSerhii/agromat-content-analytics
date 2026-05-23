import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // CSS variables drive both light/dark — see globals.css
      },
    },
  },
  plugins: [],
};

export default config;
