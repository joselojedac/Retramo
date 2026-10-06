import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { captureSession } from "../../src/capture/index";
import { SessionStore } from "../../src/session/store";
import { buildPrompt, sessionForPrompt } from "../../src/summary/provider";
import { silentLogger } from "../../src/log";
import { makeSession, tempDir } from "./helpers";

// Marca que simula contenido de un documento. Si aparece en el JSON en un
// string de más de 200 caracteres, algo está leyendo contenido de archivos.
const DOCUMENT_CONTENT = "DOCUMENT_CONTENT_" + "x".repeat(5000);
const MAX_STRING_FROM_FILES = 200;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => strings(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => strings(v, out));
  }
  return out;
}

describe("privacidad", () => {
  it("el JSON de sesión no contiene ningún string de más de 200 caracteres proveniente de un documento", async () => {
    const dir = await tempDir();
    try {
      const store = new SessionStore(dir);
      const session = await captureSession(
        { trigger: "manual", note: "nota", workspace: { name: "w", rootPath: "/w" } },
        {
          editor: async () => ({ openFiles: ["a.ts"], activeFile: "a.ts", activeLine: 1 }),
          git: async () => ({ branch: "main", modifiedFiles: ["a.ts"] }),
          terminal: async () => ({ recentCommands: ["ls"] }),
        },
        silentLogger,
      );
      await store.save(session);
      const raw = await fs.readFile(store.sessionPath(session.id), "utf8");
      const tooLong = strings(JSON.parse(raw)).filter(
        (s) => s.includes("DOCUMENT_CONTENT") && s.length > MAX_STRING_FROM_FILES,
      );
      expect(tooLong).toEqual([]);
      expect(raw).not.toContain(DOCUMENT_CONTENT);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("el código de captura no lee contenido de archivos", async () => {
    const captureDir = path.join(__dirname, "..", "..", "src", "capture");
    const files = (await fs.readdir(captureDir)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await fs.readFile(path.join(captureDir, file), "utf8");
      expect(source, file).not.toMatch(/readFile|createReadStream|openTextDocument|workspace\.fs\b|from "node:fs"|from "fs"/);
      expect(source, file).not.toMatch(/\.diff\(|getDiff|\.show\(/);
      expect(source, file).not.toMatch(/getText\(/);
    }
  });

  it("al proveedor de IA se envía sólo el JSON de la sesión, sin resumen previo", () => {
    const session = makeSession({
      summary: { text: "viejo", provider: "test", generatedAt: "2024-01-01T00:00:00.000Z" },
    });
    const sent = sessionForPrompt(session);
    expect("summary" in sent).toBe(false);
    const prompt = buildPrompt("Hola\n{session_json}\nFin", session);
    expect(prompt.startsWith("Hola\n")).toBe(true);
    expect(prompt.endsWith("\nFin")).toBe(true);
    expect(prompt).not.toContain("viejo");
    expect(JSON.parse(prompt.slice(5, -4))).toEqual(sent);
  });
});
