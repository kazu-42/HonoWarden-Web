import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

import { VITE_DEVELOPMENT_STYLE_NONCE } from "./src/security/content-security-policy";

export default defineConfig(({ command, mode }) => ({
  plugins: [cloudflare()],
  ...(command === "serve"
    ? { html: { cspNonce: VITE_DEVELOPMENT_STYLE_NONCE } }
    : {}),
  build: {
    outDir: mode === "e2e" ? "dist-e2e" : "dist",
    sourcemap: false,
    target: "es2022",
  },
}));
