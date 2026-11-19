import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.expo/**",
    ".hermes/**",
    "evidence/**",
    "apps/api/src/generated/**",
    "apps/mobile/android/**",
    "apps/mobile/dist-qa-*/**",
  ]),
  {
    ...js.configs.recommended,
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
    rules: {
      ...config.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
    },
  })),
  {
    files: ["apps/api/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        __DEV__: "readonly",
        process: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["apps/reviewer-web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);
