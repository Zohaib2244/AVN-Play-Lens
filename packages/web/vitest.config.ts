import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "packages/web/src/**/*.test.{ts,tsx}",
      "packages/web/test/**/*.test.{ts,tsx,mjs}",
    ],
    environment: "node",
    restoreMocks: true,
  },
});
