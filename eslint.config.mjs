import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";

export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "vendor/**",
      "**/vendor/**",
      ".local/**",
      "node_modules/**",
      "output/**",
      "third-party/**",
      "**/test-results/**",
      "apps/android/**/build/**",
      "apps/android/app/src/main/assets/**",
      "apps/ios/**/TerminalAssets/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.serviceworker } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
);
