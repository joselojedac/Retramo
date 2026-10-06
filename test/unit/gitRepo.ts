import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tempDir } from "./helpers";
import { createGitRunner, GitRunner } from "../../src/git/exec";

/** Repositorio git real en un directorio temporal, para tests. */
export interface TestRepo {
  root: string;
  git: GitRunner;
  run(...args: string[]): string;
  write(file: string, content: string): Promise<void>;
  commit(message: string): string;
  remove(): Promise<void>;
}

export async function makeRepo(options: { commits?: boolean } = {}): Promise<TestRepo> {
  const root = await fs.realpath(await tempDir());
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Ana", GIT_AUTHOR_EMAIL: "ana@example.com", GIT_COMMITTER_NAME: "Ana", GIT_COMMITTER_EMAIL: "ana@example.com" },
    });
  run("init", "-q", "-b", "main");
  run("config", "commit.gpgsign", "false");
  const repo: TestRepo = {
    root,
    git: createGitRunner("git", root),
    run,
    write: async (file, content) => {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), content);
    },
    commit: (message) => {
      run("add", "-A");
      run("commit", "-q", "-m", message);
      return run("rev-parse", "HEAD").trim();
    },
    remove: () => fs.rm(root, { recursive: true, force: true }),
  };
  if (options.commits !== false) {
    await repo.write("src/a.ts", "export const a = 1;\n");
    await repo.write("README.md", "# demo\n");
    repo.commit("initial");
  }
  return repo;
}

/** Huella de todo lo visible del repo: árbol de trabajo, índice y stashes. */
export async function visibleState(repo: TestRepo): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const hash = createHash("sha256").update(await fs.readFile(full)).digest("hex");
        files.push(`${path.relative(repo.root, full)} ${hash}`);
      }
    }
  }
  await walk(repo.root);
  return [
    files.sort().join("\n"),
    repo.run("ls-files", "--stage"),
    repo.run("stash", "list"),
    repo.run("status", "--porcelain=v2", "--untracked-files=all"),
    repo.run("rev-parse", "HEAD"),
    repo.run("branch", "--list"),
  ].join("\n---\n");
}
