import { describe, it, expect, afterEach } from "vitest";
import { captureBaseline } from "../../src/baseline/snapshot";
import { computeAwayChanges } from "../../src/changes/compute";
import { collectDiffs, looksSecret, MAX_DIFF_CHARS, TRUNCATED_MARK } from "../../src/changes/diffs";
import { buildPayload, buildPrompt } from "../../src/summary/provider";
import { Session } from "../../src/session/model";
import { makeSession } from "./helpers";
import { makeRepo, TestRepo } from "./gitRepo";

let repo: TestRepo | undefined;
afterEach(async () => {
  await repo?.remove();
  repo = undefined;
});

async function awaySession(r: TestRepo): Promise<Session> {
  await r.write("secreto.txt", "CONTENIDO_NO_TRACKEADO\n");
  const baseline = await captureBaseline({ git: r.git, repoRoot: r.root, workspaceRoot: r.root });
  return makeSession({
    intent: "esperando al agente",
    workspace: { name: "demo", rootPath: r.root },
    terminal: { recentCommands: ["npm test"], cwd: `${r.root}/src` },
    baseline,
    away: { startedAt: new Date().toISOString(), watchedPaths: [], overflow: 0 },
  });
}

describe("lo que se manda al proveedor", () => {
  it("sin includeDiffs: ni contenido de archivos, ni hashes, ni rutas absolutas", async () => {
    repo = await makeRepo();
    const session = await awaySession(repo);
    await repo.write("src/a.ts", "CODIGO_DEL_AGENTE\n");
    repo.commit("el agente cambia a");
    const changes = await computeAwayChanges({ session, git: repo.git, repoRoot: repo.root });
    const sent = JSON.stringify(buildPayload(session, changes));

    expect(sent).not.toContain("CODIGO_DEL_AGENTE");
    expect(sent).not.toContain("CONTENIDO_NO_TRACKEADO");
    for (const hash of Object.values(session.baseline!.untracked)) {
      expect(sent).not.toContain(hash);
    }
    expect(sent).not.toContain(session.baseline!.head);
    expect(sent).not.toContain(repo.root); // ni rootPath ni cwd
    expect(sent).not.toContain(session.id);
    // Sí va lo útil para el resumen:
    expect(sent).toContain("esperando al agente");
    expect(sent).toContain("el agente cambia a");
    expect(sent).toContain("src/a.ts");
  });

  it("buildPrompt no interpreta $& ni $' de los datos", () => {
    const payload = buildPayload(makeSession({ intent: "probar $& y $' y $$" }));
    const prompt = buildPrompt("Data:\n{payload_json}\nEnd", payload);
    expect(prompt).toContain("probar $& y $' y $$");
    expect(prompt.endsWith("\nEnd")).toBe(true);
  });
});

describe("diffs (solo con includeDiffs)", () => {
  it("incluye el código cambiado, sin archivos que parecen secretos ni borrados", async () => {
    repo = await makeRepo();
    await repo.write(".env", "TOKEN=viejo\n");
    await repo.write("src/borrar.ts", "BORRADO\n");
    repo.commit("base");
    const session = await awaySession(repo);
    await repo.write("src/a.ts", "export const a = 'NUEVO';\n");
    await repo.write(".env", "TOKEN=SECRETO_NUEVO\n");
    repo.run("rm", "-q", "src/borrar.ts");
    const changes = await computeAwayChanges({ session, git: repo.git, repoRoot: repo.root });
    const diffs = await collectDiffs(repo.git, session.baseline!.head, changes.files);
    expect(diffs).toContain("NUEVO");
    expect(diffs).not.toContain("SECRETO_NUEVO");
    expect(diffs).not.toContain("BORRADO");
    expect(changes.files.map((f) => f.path)).toContain(".env"); // figura en la lista, sin contenido
  });

  it("trunca a 20.000 caracteres", async () => {
    repo = await makeRepo();
    const session = await awaySession(repo);
    await repo.write("src/a.ts", "x".repeat(50_000) + "\n");
    const changes = await computeAwayChanges({ session, git: repo.git, repoRoot: repo.root });
    const diffs = await collectDiffs(repo.git, session.baseline!.head, changes.files);
    expect(diffs.length).toBe(MAX_DIFF_CHARS + TRUNCATED_MARK.length);
    expect(diffs.endsWith(TRUNCATED_MARK)).toBe(true);
  });

  it("un nombre de archivo con magia de pathspec se trata como ruta literal", async () => {
    repo = await makeRepo();
    await repo.write(":(top)raro.txt", "antes\n");
    repo.commit("raro");
    const session = await awaySession(repo);
    await repo.write(":(top)raro.txt", "RARO_CAMBIADO\n");
    await repo.write("README.md", "README_CAMBIADO\n");
    const diffs = await collectDiffs(repo.git, session.baseline!.head, [
      { path: ":(top)raro.txt", status: "modified", source: "git" },
    ]);
    expect(diffs).toContain("RARO_CAMBIADO");
    expect(diffs).not.toContain("README_CAMBIADO");
  });

  it("un ref inválido no llega a git", async () => {
    repo = await makeRepo();
    expect(await collectDiffs(repo.git, "--output=/tmp/x", [{ path: "a", status: "modified", source: "git" }])).toBe("");
  });

  it.each([
    [".env", true],
    ["config/.env.production", true],
    ["certs/server.pem", true],
    ["deploy.key", true],
    ["home/.ssh/id_ed25519", true],
    ["aws/credentials", true],
    ["src/secrets.ts", true],
    ["src/environment.ts", false],
    ["src/keyboard.ts", false],
    ["README.md", false],
  ])("looksSecret(%s) = %s", (path, expected) => {
    expect(looksSecret(path)).toBe(expected);
  });
});
