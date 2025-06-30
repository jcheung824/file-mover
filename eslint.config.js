import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json", // Add this if you have a tsconfig.json
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      prettier: prettier,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "max-len": "off", // Let Prettier handle line length
      "linebreak-style": ["error", "unix"],
      // Remove operator-linebreak - let Prettier handle this
      "prettier/prettier": [
        "error",
        {
          printWidth: 120,
          singleQuote: false,
          trailingComma: "es5",
          semi: true,
          tabWidth: 2,
          useTabs: false,
          endOfLine: "lf",
        },
      ],
    },
  },
  // Add Prettier config to disable conflicting rules
  prettierConfig,
  {
    files: ["**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        exports: "readonly",
        module: "readonly",
        require: "readonly",
        // Jest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
  },
  // Exclude temp directory from TypeScript parsing
  {
    files: ["temp/**/*"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        // Remove project reference for temp files
      },
    },
  },
];
