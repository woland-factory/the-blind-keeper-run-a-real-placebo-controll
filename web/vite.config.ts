import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev only: forward API calls to the backend running on 8080.
      "/api": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
