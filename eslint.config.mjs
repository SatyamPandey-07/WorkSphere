import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "prisma/seed.js",
    "scratch/**",
    "jest.setup.js",
    "wasm/**",
    "public/**/*.wasm",
    "public/ca-bundle.pem",
    "public/audio-equalizer-processor.js",
    "public/hrtf_engine.js",
    "public/*.svg",
    "public/manifest.json",
    "public/workers/**",
    "public/zkp/**",
  ]),

  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
]);

export default eslintConfig;
