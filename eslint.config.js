import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage",
      "dist",
      "dist-e2e",
      "node_modules",
      ".wrangler",
      ".workflow/*/results",
      "playwright-report",
      "test-results",
      "worker-configuration.d.ts",
    ],
  },
  {
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        location: "readonly",
        navigator: "readonly",
        window: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
