/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Dedicated Vitest config (separate from vite.config.ts so the Tailwind plugin and
// app build settings don't interfere with the jsdom test environment). These tests
// exercise REAL components (RichContentEditor + LessonsBuilder) in jsdom to prove
// teacher-entered rich text survives editing → navigation → save → reload.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // mathlive only registers a custom element via side-effect import; stub it.
      mathlive: fileURLToPath(new URL("./tests/stubs/mathlive.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Keep these deterministic and isolated.
    isolate: true,
    css: false,
  },
});