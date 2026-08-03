import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist/prototype",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "prototype.html"),
    },
  },
});
