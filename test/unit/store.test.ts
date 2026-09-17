import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SessionStore } from "../../src/session/store";
import { HISTORY_LIMIT } from "../../src/session/model";
import { ulid } from "../../src/session/ulid";
import { makeSession, tempDir } from "./helpers";

describe("SessionStore", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await tempDir();
    store = new SessionStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("escribe y lee una sesión", async () => {
    const session = makeSession({ note: "arreglando el login" });
    await store.save(session);
    const read = await store.get(session.id);
    expect(read).toEqual(session);
  });

  it("el archivo de sesión es JSON legible por humanos", async () => {
    const session = makeSession();
    await store.save(session);
    const raw = await fs.readFile(store.sessionPath(session.id), "utf8");
    expect(raw).toContain("\n  ");
    expect(JSON.parse(raw)).toEqual(session);
  });

  it("devuelve undefined para ids desconocidos o inválidos", async () => {
    expect(await store.get(ulid())).toBeUndefined();
    expect(await store.get("../../etc/passwd")).toBeUndefined();
  });

  it("lista las últimas 20, más reciente primero", async () => {
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      await store.save(
        makeSession({ id: ulid(base + i), createdAt: new Date(base + i).toISOString(), note: `n${i}` }),
      );
    }
    const list = await store.list();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].note).toBe("n24");
    expect(list[19].note).toBe("n5");
    const latest = await store.latest();
    expect(latest?.note).toBe("n24");
  });

  it("filtra por workspace", async () => {
    await store.save(makeSession({ workspace: { name: "a", rootPath: "/a" } }));
    const b = makeSession({ workspace: { name: "b", rootPath: "/b" } });
    await store.save(b);
    expect((await store.list(20, "/a")).map((e) => e.workspaceRootPath)).toEqual(["/a"]);
    expect((await store.latest("/b"))?.id).toBe(b.id);
    expect(await store.latest("/c")).toBeUndefined();
  });

  it("guardar dos veces la misma sesión no duplica el índice", async () => {
    const session = makeSession();
    await store.save(session);
    session.summary = { text: "x", provider: "test", generatedAt: new Date().toISOString() };
    await store.save(session);
    expect(await store.list()).toHaveLength(1);
    expect((await store.get(session.id))?.summary?.text).toBe("x");
  });

  it("no corrompe el índice si falla la escritura de la sesión", async () => {
    const first = makeSession();
    await store.save(first);
    const indexBefore = await fs.readFile(store.indexPath, "utf8");

    // Bloquear la carpeta de sesiones: la escritura del archivo falla.
    const failing = makeSession();
    await fs.mkdir(store.sessionPath(failing.id), { recursive: true }); // el destino es un directorio
    await expect(store.save(failing)).rejects.toThrow();

    const indexAfter = await fs.readFile(store.indexPath, "utf8");
    expect(indexAfter).toBe(indexBefore);
    expect(JSON.parse(indexAfter).sessions.map((e: { id: string }) => e.id)).toEqual([first.id]);
    // Y no quedan temporales sueltos.
    const leftovers = (await fs.readdir(store.sessionsDir)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("reconstruye el índice si está corrupto o falta", async () => {
    const a = makeSession({ createdAt: "2024-01-01T00:00:00.000Z" });
    const b = makeSession({ createdAt: "2024-01-02T00:00:00.000Z" });
    await store.save(a);
    await store.save(b);

    await fs.writeFile(store.indexPath, "{ esto no es json", "utf8");
    expect((await store.list()).map((e) => e.id)).toEqual([b.id, a.id]);

    await fs.rm(store.indexPath);
    expect((await store.list()).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(JSON.parse(await fs.readFile(store.indexPath, "utf8")).version).toBe(1);
  });

  it("ignora archivos ajenos en la carpeta de sesiones al reconstruir", async () => {
    const a = makeSession();
    await store.save(a);
    await fs.writeFile(path.join(store.sessionsDir, "notas.txt"), "hola");
    await fs.writeFile(path.join(store.sessionsDir, "roto.json"), "{");
    await fs.rm(store.indexPath);
    expect((await store.list()).map((e) => e.id)).toEqual([a.id]);
  });
});
