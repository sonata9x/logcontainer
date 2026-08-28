import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Existing client components intentionally load remote state from effects and use
    // full-page navigation after authentication. Preserve those established flows.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "@next/next/no-location-assign-relative-destination": "off"
    }
  },
  globalIgnores([".next/**", ".next-dev/**", "node_modules/**", "next-env.d.ts"])
]);

export default config;
