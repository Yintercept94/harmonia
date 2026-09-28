import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // One classic <script> and one <style>, with the font inlined as a data URL:
    // tools/inline.mjs then folds them into a single file that opens from disk.
    assetsInlineLimit: 1_000_000,
    modulePreload: false,
    rollupOptions: { output: { format: "iife" } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
