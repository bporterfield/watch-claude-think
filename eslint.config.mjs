// eslint.config.mjs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // Base JS rules
  js.configs.recommended,

  // TypeScript recommended (parser + plugin wired in)
  ...tseslint.configs.recommended,

  // Turn off formatting rules so Prettier owns formatting
  prettier,

  // Custom rules
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Global ignores
  {
    ignores: [
      "dist/**",
      "**/dist/**",
      "**/*.d.ts",
      "node_modules/**",
      "**/node_modules/**",
      "coverage/**",
      "**/*.tsbuildinfo",
      ".git/**",
      "scratch/**", // Scratch files - see scratch/eslint.config.mjs for lenient linting
    ],
  }
);
