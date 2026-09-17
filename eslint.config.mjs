import typescriptEslint from "typescript-eslint";

export default [
  {
    ignores: ["out/**", "node_modules/**", "*.vsix"],
  },
  ...typescriptEslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
    },
  },
];
