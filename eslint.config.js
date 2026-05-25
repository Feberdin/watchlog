/**
 * Purpose: Shared ESLint configuration for the WatchLog monorepo.
 * Input/Output: ESLint reads this file and checks TypeScript/React source.
 * Invariants: Keep lint rules practical and focused on maintainable code.
 * Debugging: Run `npm run lint` and inspect file/line output.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", "apps/web/dist/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
];
