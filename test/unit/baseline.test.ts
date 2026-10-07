import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { captureBaseline, LARGE, LINK, MAX_UNTRACKED_FILE_BYTES } from "../../src/baseline/snapshot";
import { isObjectId } from "../../src/git/objectId";
import { makeRepo, TestRepo, visibleState } from "./gitRepo";

let repo: TestRepo | undefined;
afterEach(async () => {
  await repo?.remove();
  repo = undefined;
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("línea de base", () => {
  it("sin cambios: git stash create no da snapshot y se usa head, sin error", async () => {
    repo = await makeRepo();
    const head = repo.run("rev-parse", "HEAD").trim();
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(baseline.head).toBe(head);
    expect(baseline.branch).toBe("main");
    expect(baseline.snapshot).toBeUndefined();
    expect(baseline.error).toBeUndefined();
    expect(baseline.repoRoot).toBe("");
  });

  it("con cambios: hay snapshot y git stash create no modifica nada visible", async () => {
    repo = await makeRepo();
    await repo.write("src/a.ts", "export const a = 2;\n"); // sin stagear
    await repo.write("README.md", "# cambiado\n");
    repo.run("add", "README.md"); // stageado
    await repo.write("notas.txt", "nuevo\n"); // no trackeado
    const before = await visibleState(repo);
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(isObjectId(baseline.snapshot)).toBe(true);
    expect(await visibleState(repo)).toBe(before);
    // El snapshot guarda el árbol de trabajo tal como estaba.
    expect(repo.run("show", `${baseline.snapshot}:src/a.ts`)).toBe("export const a = 2;\n");
  });

  it("los no trackeados se guardan como hash, nunca su contenido", async () => {
    repo = await makeRepo();
    await repo.write("secreto.txt", "CONTENIDO_SECRETO\n");
    await repo.write("dir/otro.txt", "otro\n");
    await repo.write(".gitignore", "ignorado.log\n");
    await repo.write("ignorado.log", "no debería aparecer\n");
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(baseline.untracked).toEqual({
      ".gitignore": sha256("ignorado.log\n"),
      "dir/otro.txt": sha256("otro\n"),
      "secreto.txt": sha256("CONTENIDO_SECRETO\n"),
    });
    expect(JSON.stringify(baseline)).not.toContain("CONTENIDO_SECRETO");
  });

  it("archivos grandes y enlaces no se leen", async () => {
    repo = await makeRepo();
    await repo.write("grande.bin", "x".repeat(MAX_UNTRACKED_FILE_BYTES + 1));
    await fs.symlink("/etc/hostname", path.join(repo.root, "enlace"));
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(baseline.untracked["grande.bin"]).toBe(LARGE);
    expect(baseline.untracked["enlace"]).toBe(LINK);
  });

  it("repo sin commits: registra el error y devuelve la línea de base igual", async () => {
    repo = await makeRepo({ commits: false });
    await repo.write("a.txt", "a\n");
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(baseline.head).toBe("");
    expect(baseline.snapshot).toBeUndefined();
    expect(baseline.error).toMatch(/no commits/);
    expect(baseline.untracked["a.txt"]).toBe(sha256("a\n"));
  });

  it("HEAD desacoplado: branch vacío", async () => {
    repo = await makeRepo();
    repo.run("checkout", "-q", "--detach");
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    expect(baseline.branch).toBe("");
    expect(isObjectId(baseline.head)).toBe(true);
  });

  it("repoRoot es relativo al workspace", async () => {
    repo = await makeRepo();
    const baseline = await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: path.dirname(repo.root) });
    expect(baseline.repoRoot).toBe(path.basename(repo.root));
  });

  it("no ejecuta el hook de fsmonitor del repo", async () => {
    repo = await makeRepo();
    const marker = path.join(repo.root, "..", `fsmonitor-${path.basename(repo.root)}`);
    const hook = path.join(repo.root, "hook.sh");
    await fs.writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    repo.run("config", "core.fsmonitor", hook);
    await repo.write("src/a.ts", "cambio\n");
    await captureBaseline({ git: repo.git, repoRoot: repo.root, workspaceRoot: repo.root });
    await expect(fs.access(marker)).rejects.toThrow();
    // Control: el mismo hook sí corre con un git normal, así que el test prueba algo.
    try {
      repo.run("status");
    } catch {
      // el hook no responde como fsmonitor; alcanza con que haya corrido
    }
    await expect(fs.access(marker)).resolves.toBeUndefined();
    await fs.rm(marker, { force: true });
  });
});
