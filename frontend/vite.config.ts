import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // esbuild minifies the CSS as before vite 8: Lightning CSS (the vite 8 default) drops the `vh` fallback written
  // before each `dvh` height, which older mobile browsers still need (review-flow.spec.ts checks the built CSS).
  // The target is the default of vite 5 and 6 ("modules"), which vite 8 raised: the bundle stays ES2020 (no `??=`).
  build: { cssMinify: "esbuild", target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"] },
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
