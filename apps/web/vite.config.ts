/**
 * Purpose: Vite configuration for the WatchLog web UI.
 * Input/Output: Dev server proxies API calls; production build emits static files.
 * Invariants: API requests use `/api` so Docker and local development share paths.
 * Debugging: If the UI cannot reach the API in dev, check the proxy target and API port.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8111",
    },
  },
});
