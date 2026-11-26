import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Database rows and third-party API payloads are loosely typed on purpose.
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
  // `const { key, ...rest } = row` is how a field is dropped from a row; the dropped name is not a mistake.
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }] } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
