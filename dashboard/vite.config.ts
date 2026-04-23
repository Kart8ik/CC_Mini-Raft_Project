import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "board.html"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
