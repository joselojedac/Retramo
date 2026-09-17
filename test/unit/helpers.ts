import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/session/model";
import { ulid } from "../../src/session/ulid";

export async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "reentry-test-"));
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: ulid(),
    createdAt: new Date().toISOString(),
    trigger: "manual",
    workspace: { name: "demo", rootPath: "/tmp/demo" },
    editor: { openFiles: ["src/a.ts"], activeFile: "src/a.ts", activeLine: 3 },
    ...overrides,
  };
}
