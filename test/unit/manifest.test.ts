import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
const settings: Record<string, { scope?: string }> = manifest.contributes.configuration.properties;

describe("package.json", () => {
  // Un .vscode/settings.json de un repo no puede cambiar a dónde se mandan las
  // sesiones ni activar algo que el usuario no activó: solo valen sus ajustes de usuario.
  it.each([
    "retramo.summary.provider",
    "retramo.summary.ollamaEndpoint",
    "retramo.telemetry",
  ])("%s solo se puede configurar a nivel usuario", (key) => {
    expect(settings[key]?.scope).toBe("application");
  });
});
