import { defineConfig } from "@vscode/test-cli";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Workspace temporal para que "Me fui" tenga una carpeta que capturar.
const workspaceFolder = mkdtempSync(join(tmpdir(), "reentry-ws-"));
mkdirSync(join(workspaceFolder, "src"));
writeFileSync(join(workspaceFolder, "src", "main.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  version: "stable",
  workspaceFolder,
  mocha: {
    ui: "tdd",
    timeout: 20000,
  },
});
