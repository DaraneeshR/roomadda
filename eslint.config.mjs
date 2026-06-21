// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Root flat config shared by every workspace package. Each package runs
 * `eslint .`; ESLint walks up to find this file. Type-aware rules are left
 * off on purpose so linting stays fast and does not require a built project.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.d.ts",
      "**/scripts/**",
      "mobile/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
