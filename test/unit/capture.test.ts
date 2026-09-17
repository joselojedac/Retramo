import { describe, it, expect } from "vitest";
import { captureSession, Capturers } from "../../src/capture/index";
import { Logger } from "../../src/log";
import { isUlid } from "../../src/session/ulid";

function collectingLogger(): Logger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => errors.push(message),
  };
}

const input = { trigger: "manual" as const, note: "  probando  ", workspace: { name: "w", rootPath: "/w" } };

const okCapturers: Capturers = {
  editor: async () => ({ openFiles: ["a.ts", "b.ts"], activeFile: "a.ts", activeLine: 10 }),
  git: async () => ({ branch: "main", modifiedFiles: ["a.ts"], lastCommitMessage: "init" }),
  terminal: async () => ({ recentCommands: ["npm test"], cwd: "/w" }),
};

describe("captureSession", () => {
  it("arma una sesión completa cuando todo funciona", async () => {
    const log = collectingLogger();
    const session = await captureSession(input, okCapturers, log);
    expect(isUlid(session.id)).toBe(true);
    expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    expect(session.trigger).toBe("manual");
    expect(session.note).toBe("probando");
    expect(session.workspace).toEqual(input.workspace);
    expect(session.editor.activeFile).toBe("a.ts");
    expect(session.git?.branch).toBe("main");
    expect(session.terminal?.recentCommands).toEqual(["npm test"]);
    expect(log.errors).toEqual([]);
  });

  it("si un capturador lanza, la sesión igual se arma con los demás campos", async () => {
    const log = collectingLogger();
    const session = await captureSession(
      input,
      { ...okCapturers, git: async () => { throw new Error("git no disponible"); } },
      log,
    );
    expect(session.git).toBeUndefined();
    expect(session.editor.activeFile).toBe("a.ts");
    expect(session.terminal?.recentCommands).toEqual(["npm test"]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toContain('"git"');
  });

  it("si falla el editor, queda una lista vacía de archivos", async () => {
    const log = collectingLogger();
    const session = await captureSession(
      { ...input, note: undefined, trigger: "idle" },
      {
        editor: async () => { throw new Error("boom"); },
        git: async () => undefined,
        terminal: async () => { throw new Error("boom"); },
      },
      log,
    );
    expect(session.editor).toEqual({ openFiles: [] });
    expect(session.note).toBeUndefined();
    expect(session.git).toBeUndefined();
    expect(session.terminal).toBeUndefined();
    expect(session.trigger).toBe("idle");
    expect(log.errors.map((e) => /"(\w+)"/.exec(e)?.[1]).sort()).toEqual(["editor", "terminal"]);
  });

  it("una nota vacía no se guarda", async () => {
    const session = await captureSession({ ...input, note: "   " }, okCapturers, collectingLogger());
    expect("note" in session).toBe(false);
  });
});
