import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:7860",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:7860",
        changeOrigin: true,
      },
    },
  },
});
