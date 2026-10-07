import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { migrateSession } from "../../src/session/migrate";
import { isObjectId } from "../../src/git/objectId";
import { SessionStore } from "../../src/session/store";
import { ulid } from "../../src/session/ulid";
import { tempDir } from "./helpers";

const SHA1 = "a".repeat(40);
const SHA256 = "b".repeat(64);

const v1 = {
  id: "01J9X4M3V9K2Q4R8T7W1Z5B6C7",
  createdAt: "2026-09-20T10:00:00.000Z",
  trigger: "manual",
  note: "arreglando el login",
  workspace: { name: "app", rootPath: "/home/me/app" },
  editor: { openFiles: ["a.ts"], activeFile: "a.ts", activeLine: 3, activeSelection: "const secreto = 1" },
  git: { branch: "main", modifiedFiles: ["a.ts"], lastCommitMessage: "wip" },
  terminal: { recentCommands: ["npm test"], cwd: "/home/me/app" },
};

describe("migración v1 -> v2", () => {
  it("note pasa a intent y activeSelection se descarta", () => {
    const session = migrateSession(v1)!;
    expect(session.schemaVersion).toBe(2);
    expect(session.intent).toBe("arreglando el login");
    expect("note" in session).toBe(false);
    expect("activeSelection" in session.editor).toBe(false);
    expect(session.editor).toEqual({ openFiles: ["a.ts"], activeFile: "a.ts", activeLine: 3 });
    expect(session.git).toEqual(v1.git);
    expect(session.terminal).toEqual(v1.terminal);
    expect(session.baseline).toBeUndefined();
    expect(session.away).toBeUndefined();
  });

  it("la intención se recorta a 200 caracteres", () => {
    expect(migrateSession({ ...v1, note: "x".repeat(500) })!.intent).toHaveLength(200);
  });

  it("rechaza lo que no tiene forma de sesión", () => {
    expect(migrateSession(null)).toBeUndefined();
    expect(migrateSession([])).toBeUndefined();
    expect(migrateSession({ id: 1 })).toBeUndefined();
    expect(migrateSession({ ...v1, workspace: "x" })).toBeUndefined();
  });

  it("el store lee un archivo v1 del disco sin reescribirlo", async () => {
    const dir = await tempDir();
    try {
      const store = new SessionStore(dir);
      await fs.mkdir(store.sessionsDir, { recursive: true });
      const id = ulid();
      const raw = JSON.stringify({ ...v1, id });
      await fs.writeFile(store.sessionPath(id), raw);
      const latest = await store.latest();
      expect(latest?.intent).toBe("arreglando el login");
      expect((await store.list())[0].intent).toBe("arreglando el login");
      expect(await fs.readFile(store.sessionPath(id), "utf8")).toBe(raw);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("hashes de la línea de base", () => {
  it("isObjectId acepta solo SHA-1 o SHA-256 completos en minúscula", () => {
    expect(isObjectId(SHA1)).toBe(true);
    expect(isObjectId(SHA256)).toBe(true);
    for (const bad of ["", "abc", "A".repeat(40), SHA1 + "\n", " " + SHA1, "--output=/tmp/x", "HEAD", "HEAD~1", 42, null]) {
      expect(isObjectId(bad), String(bad)).toBe(false);
    }
  });

  it("un hash inválido en una sesión se descarta y nunca llega a git", () => {
    const session = migrateSession({
      ...v1,
      baseline: {
        repoRoot: "",
        head: "--output=/tmp/x",
        branch: "main",
        snapshot: "-c core.pager=evil",
        untracked: { "a.txt": "x", "b.txt": 5 },
        capturedAt: v1.createdAt,
      },
    })!;
    expect(session.baseline?.head).toBe("");
    expect(session.baseline?.snapshot).toBeUndefined();
    expect(session.baseline?.untracked).toEqual({ "a.txt": "x" });
  });

  it("conserva una línea de base válida", () => {
    const baseline = { repoRoot: "", head: SHA1, branch: "main", snapshot: SHA256, untracked: {}, capturedAt: v1.createdAt };
    expect(migrateSession({ ...v1, schemaVersion: 2, baseline })!.baseline).toEqual(baseline);
  });
});

describe("cambios congelados al volver", () => {
  const away = (changes: unknown) => ({
    ...v1,
    schemaVersion: 2,
    away: { startedAt: v1.createdAt, endedAt: v1.createdAt, watchedPaths: [], overflow: 0, changes },
  });

  it("se conservan tal cual si son válidos", () => {
    const changes = {
      minutesAway: 47,
      branchChanged: { from: "fix/x", to: "main" },
      newCommits: [{ hash: SHA1, subject: "Add CI workflow", author: "Ana" }],
      files: [{ path: "src/a.ts", status: "modified", source: "git" }],
      overflow: 3,
      historyRewritten: true,
    };
    expect(migrateSession(away(changes))!.away?.changes).toEqual(changes);
  });

  it("descarta commits con hash inválido y archivos con estado o fuente desconocidos", () => {
    const changes = migrateSession(
      away({
        minutesAway: 5,
        newCommits: [
          { hash: "--output=/tmp/x", subject: "malo", author: "x" },
          { hash: SHA1, subject: "bueno", author: "Ana" },
        ],
        files: [
          { path: "a", status: "exploded", source: "git" },
          { path: "b", status: "added", source: "magic" },
          { path: "c", status: "deleted", source: "watcher" },
        ],
        overflow: -2,
      }),
    )!.away?.changes;
    expect(changes?.newCommits.map((c) => c.subject)).toEqual(["bueno"]);
    expect(changes?.files.map((f) => f.path)).toEqual(["c"]);
    expect(changes?.overflow).toBe(0);
  });

  it("una forma inválida se ignora sin romper la sesión", () => {
    const session = migrateSession(away({ minutesAway: "mucho" }))!;
    expect(session.away?.changes).toBeUndefined();
    expect(session.away?.endedAt).toBe(v1.createdAt);
  });
});

