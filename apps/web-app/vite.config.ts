import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // In production the daemon serves this SPA, so the page origin is
    // the daemon and lib/connection.ts resolves to it. In dev Vite owns
    // the origin, so forward the two backend routes to the daemon —
    // otherwise `pnpm dev` would POST /api to Vite itself.
    proxy: {
      "/api": { target: "http://127.0.0.1:4096", changeOrigin: true },
      "/events": {
        target: "http://127.0.0.1:4096",
        changeOrigin: true,
        // SSE must stream, not buffer.
        ws: false,
      },
    },
  },
});
