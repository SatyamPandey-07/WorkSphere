import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "prisma/seed.js",
    "scratch/**",
    "jest.setup.js",
    "wasm/**",
    // Generated / third-party files in public/ (not manually-written JS)
    "public/*.wasm",
    "public/ca-bundle.pem",
    "public/*.svg",
    "public/hrtf_engine.js",
    "public/manifest.json",
    "public/fonts/**",
    "public/icons/**",
    "public/images/**",
    "public/leaflet/**",
    "public/workers/**",
    "public/zkp/**",
  ]),
  // Custom rules for this project
  {
    settings: {
      react: {
        version: "19.2.7",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    }
  }
]);

export default eslintConfig;
