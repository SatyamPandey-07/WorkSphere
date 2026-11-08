import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Ensure react version is explicitly specified to prevent eslint-plugin-react
// from invoking deprecated/removed contextOrFilename.getFilename() in ESLint 9/10
for (const config of nextVitals) {
  if (config.settings?.react) {
    config.settings.react.version = "19.0";
  }
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    ".kilo/**",
    ".agents/**",
    ".claude/**",
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
        version: "19.0",
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
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;
