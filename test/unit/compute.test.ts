import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { captureBaseline } from "../../src/baseline/snapshot";
import { computeAwayChanges, minutesAway } from "../../src/changes/compute";
import { migrateSession } from "../../src/session/migrate";
import { GitRunner } from "../../src/git/exec";
import { Session } from "../../src/session/model";
import { makeSession } from "./helpers";
import { makeRepo, TestRepo } from "./gitRepo";

let repo: TestRepo | undefined;
afterEach(async () => {
  await repo?.remove();
  repo = undefined;
});

async function leave(r: TestRepo, extra: Partial<Session> = {}): Promise<Session> {
  const baseline = await captureBaseline({ git: r.git, repoRoot: r.root, workspaceRoot: r.root });
  return makeSession({ workspace: { name: "demo", rootPath: r.root }, baseline, ...extra });
}

const compute = (r: TestRepo, session: Session) => computeAwayChanges({ session, git: r.git, repoRoot: r.root });

describe("mientras no estabas", () => {
  it("detecta un archivo modificado desde fuera de VS Code", async () => {
    repo = await makeRepo();
    const session = await leave(repo);
    await fs.writeFile(path.join(repo.root, "src/a.ts"), "export const a = 99;\n"); // "el agente"
    const changes = await compute(repo, session);
    expect(changes.files).toEqual([{ path: "src/a.ts", status: "modified", source: "git" }]);
    expect(changes.newCommits).toEqual([]);
  });

  it("solo informa lo que cambió después de irse, no lo que ya estaba sin commitear", async () => {
    repo = await makeRepo();
    await repo.write("src/a.ts", "cambio mío antes de irme\n");
    await repo.write("README.md", "# también mío\n");
    const session = await leave(repo);
    await repo.write("README.md", "# lo cambió el agente\n");
    const changes = await compute(repo, session);
    expect(changes.files).toEqual([{ path: "README.md", status: "modified", source: "git" }]);
  });

  it("lista los commits nuevos con autor, y sus cambios", async () => {
    repo = await makeRepo();
    const session = await leave(repo);
    await repo.write("src/b.ts", "export const b = 1;\n");
    repo.commit("agrega b");
    await repo.write("src/a.ts", "export const a = 2;\n");
    repo.commit("cambia a");
    const changes = await compute(repo, session);
    expect(changes.newCommits.map((c) => [c.subject, c.author])).toEqual([["cambia a", "Ana"], ["agrega b", "Ana"]]);
    expect(changes.files).toEqual(
      expect.arrayContaining([
        { path: "src/b.ts", status: "added", source: "git" },
        { path: "src/a.ts", status: "modified", source: "git" },
      ]),
    );
  });

  it("no trackeados: nuevos, modificados y borrados", async () => {
    repo = await makeRepo();
    await repo.write("queda.txt", "igual\n");
    await repo.write("cambia.txt", "antes\n");
    await repo.write("se-va.txt", "x\n");
    const session = await leave(repo);
    await repo.write("cambia.txt", "después\n");
    await fs.rm(path.join(repo.root, "se-va.txt"));
    await repo.write("nuevo.txt", "hola\n");
    const changes = await compute(repo, session);
    expect(changes.files).toHaveLength(3);
    expect(changes.files).toEqual(
      expect.arrayContaining([
        { path: "cambia.txt", status: "modified", source: "untracked" },
        { path: "se-va.txt", status: "deleted", source: "untracked" },
        { path: "nuevo.txt", status: "added", source: "untracked" },
      ]),
    );
  });

  it("un no trackeado que se agregó al índice sin cambios no cuenta", async () => {
    repo = await makeRepo();
    await repo.write("notas.txt", "igual\n");
    const session = await leave(repo);
    repo.run("add", "notas.txt");
    expect((await compute(repo, session)).files).toEqual([]);
  });

  it("snapshot perdido por git gc: compara contra head y lo avisa", async () => {
    repo = await makeRepo();
    await repo.write("src/a.ts", "sin commitear\n");
    const session = await leave(repo);
    expect(session.baseline?.snapshot).toBeDefined();
    repo.run("gc", "--prune=now", "--quiet");
    const changes = await compute(repo, session);
    expect(changes.baselineLost).toBe(true);
    // Contra head, el cambio que ya estaba al irse aparece como si fuera nuevo.
    expect(changes.files).toEqual([{ path: "src/a.ts", status: "modified", source: "git" }]);
  });

  it("cambio de rama: branchChanged y sin diff de archivos", async () => {
    repo = await makeRepo();
    const session = await leave(repo);
    repo.run("checkout", "-q", "-b", "feature-x");
    await repo.write("src/x.ts", "x\n");
    repo.commit("feature x");
    const changes = await compute(repo, session);
    expect(changes.branchChanged).toEqual({ from: "main", to: "feature-x" });
    expect(changes.files).toEqual([]);
    expect(changes.newCommits.map((c) => c.subject)).toEqual(["feature x"]);
  });

  it("historia reescrita (reset): lo dice en vez de listar commits", async () => {
    repo = await makeRepo();
    await repo.write("src/b.ts", "b\n");
    repo.commit("segundo");
    const session = await leave(repo);
    repo.run("reset", "-q", "--hard", "HEAD~1");
    const changes = await compute(repo, session);
    expect(changes.historyRewritten).toBe(true);
    expect(changes.newCommits).toEqual([]);
  });

  it("sin línea de base (v1 o sin git): solo minutos y watcher", async () => {
    const session = makeSession({
      away: { startedAt: new Date(Date.now() - 47 * 60_000).toISOString(), watchedPaths: ["src/a.ts"], overflow: 3 },
    });
    const changes = await computeAwayChanges({ session });
    expect(changes.minutesAway).toBe(47);
    expect(changes.files).toEqual([{ path: "src/a.ts", status: "deleted", source: "watcher" }]);
    expect(changes.overflow).toBe(3);
    expect(changes.newCommits).toEqual([]);
  });

  it("el watcher no duplica lo que ya informó git", async () => {
    repo = await makeRepo();
    const session = await leave(repo, {
      away: { startedAt: new Date().toISOString(), watchedPaths: ["src/a.ts", "dist/bundle.js"], overflow: 0 },
    });
    await repo.write("src/a.ts", "cambio\n");
    await repo.write(".gitignore", "dist/\n");
    await repo.write("dist/bundle.js", "build\n");
    const changes = await compute(repo, session);
    expect(changes.files).toEqual([
      { path: "src/a.ts", status: "modified", source: "git" },
      { path: ".gitignore", status: "added", source: "untracked" },
      { path: "dist/bundle.js", status: "modified", source: "watcher" },
    ]);
  });

  it("nada cambió: listas vacías", async () => {
    repo = await makeRepo();
    const session = await leave(repo);
    const changes = await compute(repo, session);
    expect(changes).toMatchObject({ newCommits: [], files: [], overflow: 0 });
    expect(changes.branchChanged).toBeUndefined();
  });

  it("un hash inválido en la sesión nunca llega a git", async () => {
    repo = await makeRepo();
    const calls: string[][] = [];
    const spy: GitRunner = (args, options) => {
      calls.push(args);
      return repo!.git(args, options);
    };
    const raw = makeSession({ workspace: { name: "demo", rootPath: repo.root } }) as unknown as Record<string, unknown>;
    raw.baseline = {
      repoRoot: "",
      head: "--output=/tmp/retramo-pwned",
      branch: "main",
      snapshot: "--exec=evil",
      untracked: {},
      capturedAt: new Date().toISOString(),
    };
    const session = migrateSession(raw)!;
    await computeAwayChanges({ session, git: spy, repoRoot: repo.root });
    expect(calls.flat().some((arg) => arg.includes("--output") || arg.includes("--exec"))).toBe(false);
  });

  it("minutesAway usa el inicio de la ausencia y su fin si ya se detectó el regreso", () => {
    const session = makeSession({
      away: { startedAt: "2026-10-06T10:00:00.000Z", endedAt: "2026-10-06T10:47:00.000Z", watchedPaths: [], overflow: 0 },
    });
    expect(minutesAway(session, new Date("2026-10-06T12:00:00.000Z"))).toBe(47);
  });
});
