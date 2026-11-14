import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // esbuild minifies the CSS as before vite 8: Lightning CSS (the vite 8 default) drops the `vh` fallback written
  // before each `dvh` height, which older mobile browsers still need (review-flow.spec.ts checks the built CSS).
  build: { cssMinify: "esbuild" },
  // The dev server may read the bundled handbook (src/help/handbook.ts) outside the frontend root.
  server: { fs: { allow: [".", "../docs/handbook"] } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}", "tests/e2e/**/*.spec.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/api/generated.ts"],
      reporter: ["text-summary", "html", "json-summary"],
    },
  },
});
