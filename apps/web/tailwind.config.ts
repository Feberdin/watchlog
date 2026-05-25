/**
 * Purpose: Tailwind content and theme config for the web UI.
 * Input/Output: Tailwind scans React files and outputs only used classes.
 * Invariants: Keep the palette restrained and readable in dark mode.
 * Debugging: If classes do not appear, verify the content glob includes the component file.
 */

import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        panel: "#18202f",
        accent: "#2dd4bf",
      },
    },
  },
  plugins: [],
} satisfies Config;
