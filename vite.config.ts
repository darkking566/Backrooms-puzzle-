import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { contentPlugin } from "./tools/content-plugin";

export default defineConfig({
  base: "./",
  plugins: [preact(), contentPlugin()],
  build: { target: "es2020", chunkSizeWarningLimit: 900 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] }
});
