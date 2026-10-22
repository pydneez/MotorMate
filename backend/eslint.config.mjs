// ESLint for the NestJS backend: the recommended JavaScript + TypeScript rules, plus the two
// promise rules that need type information — a missed `await` in a service can let a
// request answer before its database write has finished. Formatting is not linted.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-seed/**", "coverage/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // `import X = require("…")` is how CommonJS-only packages (pdfkit) are imported here.
      "@typescript-eslint/no-require-imports": ["error", { allowAsImport: true }],
      // `_`-prefixed names are deliberately unused (e.g. destructuring a field away).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    // Tests and the seed lean on loose mocks and `require()` after setting env vars.
    files: ["test/**/*.ts", "src/**/*.spec.ts", "prisma/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
