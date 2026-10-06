import { describe, it, expect } from "vitest";
import { AwayLog, globToRegExp } from "../../src/away/log";

describe("AwayLog", () => {
  it("1.000 cambios generan 200 rutas y overflow de 800", () => {
    const log = new AwayLog();
    for (let i = 0; i < 1000; i++) {
      log.add(`src/file-${i}.ts`);
    }
    const { watchedPaths, overflow } = log.snapshot();
    expect(watchedPaths).toHaveLength(200);
    expect(watchedPaths[0]).toBe("src/file-0.ts");
    expect(watchedPaths[199]).toBe("src/file-199.ts");
    expect(overflow).toBe(800);
  });

  it("deduplica y conserva el orden de aparición", () => {
    const log = new AwayLog();
    for (const p of ["b.ts", "a.ts", "b.ts", "c.ts", "a.ts"]) {
      log.add(p);
    }
    expect(log.snapshot()).toEqual({ watchedPaths: ["b.ts", "a.ts", "c.ts"], overflow: 0 });
  });

  it("los repetidos no cuentan para el overflow", () => {
    const log = new AwayLog();
    for (let i = 0; i < 250; i++) {
      log.add(`f${i}`);
      log.add(`f${i}`);
    }
    expect(log.snapshot().overflow).toBe(50);
  });

  it("excluye .git, node_modules y carpetas generadas en cualquier nivel", () => {
    const log = new AwayLog();
    for (const p of [".git/index", "node_modules/x/index.js", "packages/app/node_modules/y.js", "dist/a.js", "out/src/x.js", ".next/cache", "target/debug/app", "src/ok.ts"]) {
      log.add(p);
    }
    expect(log.snapshot().watchedPaths).toEqual(["src/ok.ts"]);
  });

  it("excluye con los patrones del usuario", () => {
    const log = new AwayLog([globToRegExp("**/*.log"), globToRegExp("coverage"), globToRegExp("tmp/**")]);
    for (const p of ["a.log", "logs/b.log", "coverage/index.html", "tmp/x/y.txt", "src/a.ts"]) {
      log.add(p);
    }
    expect(log.snapshot().watchedPaths).toEqual(["src/a.ts"]);
  });

  it("ignora rutas fuera de la raíz", () => {
    const log = new AwayLog();
    expect(log.add("../otro/a.ts")).toBe(false);
    expect(log.add("")).toBe(false);
  });

  it("revision cambia solo cuando se registra algo nuevo", () => {
    const log = new AwayLog();
    const r0 = log.revision;
    log.add("a");
    const r1 = log.revision;
    log.add("a");
    expect(r1).not.toBe(r0);
    expect(log.revision).toBe(r1);
  });
});

describe("globToRegExp", () => {
  it.each([
    ["**/*.log", "a.log", true],
    ["**/*.log", "x/y/a.log", true],
    ["**/*.log", "a.ts", false],
    ["*.tmp", "deep/dir/file.tmp", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/x/a.ts", false],
    ["build", "build/a/b.js", true],
    ["a?c.txt", "abc.txt", true],
    ["a.c", "abc", false],
  ])("%s contra %s -> %s", (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});
