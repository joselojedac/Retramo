import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AwayController, AwayDeps, AwayRecording, FLUSH_MS, GRACE_MS, QUIET_MS, SaveInput } from "../../src/away/controller";
import { AwayLog } from "../../src/away/log";
import { Baseline, Session } from "../../src/session/model";
import { silentLogger } from "../../src/log";
import { makeSession } from "./helpers";

const IDLE_MS = 20 * 60_000;
const T0 = Date.parse("2026-10-06T10:00:00.000Z");

function setup() {
  let recordings = 0;
  const made: (AwayRecording & { stopped: boolean; baseline: Baseline })[] = [];
  const saved: SaveInput[] = [];
  const persisted: Session[] = [];
  const returned: Session[] = [];
  const deps: AwayDeps = {
    idleMs: () => IDLE_MS,
    now: () => Date.now(),
    log: silentLogger,
    startRecording: async () => {
      recordings++;
      const rec = {
        baseline: { repoRoot: "", head: "a".repeat(40), branch: "main", untracked: {}, capturedAt: new Date().toISOString() },
        draft: makeSession({ createdAt: new Date().toISOString() }),
        log: new AwayLog(),
        stopped: false,
        stop() {
          rec.stopped = true;
        },
      };
      made.push(rec);
      return rec;
    },
    saveSession: async (input) => {
      saved.push(input);
      return makeSession({ trigger: input.trigger, intent: input.intent, baseline: input.baseline, away: { ...input.away } });
    },
    persist: async (session) => {
      persisted.push(JSON.parse(JSON.stringify(session)));
    },
    onReturn: (session) => {
      returned.push(session);
    },
  };
  const controller = new AwayController(deps);
  return { controller, made, saved, persisted, returned, recordings: () => recordings };
}

describe("AwayController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("la sesión automática usa la línea de base de los 2 minutos, no la de los 20", async () => {
    const { controller, made, saved } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(made).toHaveLength(1);
    expect(made[0].baseline.capturedAt).toBe(new Date(T0 + QUIET_MS).toISOString());
    made[0].log.add("src/a.ts"); // el agente trabaja entre el minuto 2 y el 20
    await vi.advanceTimersByTimeAsync(IDLE_MS - QUIET_MS);
    expect(saved).toHaveLength(1);
    expect(saved[0].trigger).toBe("idle");
    expect(saved[0].baseline).toBe(made[0].baseline);
    expect(saved[0].away.startedAt).toBe(new Date(T0).toISOString()); // la última presencia
    expect(saved[0].away.watchedPaths).toEqual(["src/a.ts"]);
    expect(made).toHaveLength(1); // no tomó otra línea de base a los 20
    expect(saved[0].draft).toBe(made[0].draft); // ni otra foto del editor y git
  });

  it("si vuelve antes de la inactividad, la candidata se descarta", async () => {
    const { controller, made, saved } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(QUIET_MS + 1000);
    expect(made).toHaveLength(1);
    controller.presence();
    expect(made[0].stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(made).toHaveLength(2); // nueva candidata tras otro silencio
    expect(saved).toHaveLength(0);
  });

  it("al volver después de la sesión automática, avisa el regreso con endedAt", async () => {
    const { controller, made, returned } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5 * 60_000);
    controller.presence();
    await vi.advanceTimersByTimeAsync(0);
    expect(returned).toHaveLength(1);
    expect(returned[0].away?.endedAt).toBe(new Date(T0 + IDLE_MS + 5 * 60_000).toISOString());
    expect(made[0].stopped).toBe(true);
    expect(controller.activeSession).toBeUndefined();
  });

  it("nunca dos sesiones automáticas sin presencia en el medio", async () => {
    const { controller, saved } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(IDLE_MS * 5);
    expect(saved).toHaveLength(1);
  });

  it("I'm leaving: la actividad del minuto de gracia no cuenta como regreso", async () => {
    const { controller, saved, returned } = setup();
    controller.start();
    const session = await controller.leaveManual("esperando al agente");
    expect(saved[0]).toMatchObject({ trigger: "manual", intent: "esperando al agente" });
    expect(session?.away?.startedAt).toBe(new Date(T0).toISOString());
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1000);
    controller.presence(); // todavía se está yendo
    await vi.advanceTimersByTimeAsync(0);
    expect(returned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    controller.presence();
    await vi.advanceTimersByTimeAsync(0);
    expect(returned).toHaveLength(1);
  });

  it("I'm leaving descarta la candidata y toma su propia línea de base", async () => {
    const { controller, made, saved } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await controller.leaveManual(undefined);
    expect(made[0].stopped).toBe(true);
    expect(saved[0].baseline).toBe(made[1].baseline);
  });

  it("sin inactividad mientras hay una ausencia abierta", async () => {
    const { controller, saved } = setup();
    controller.start();
    await controller.leaveManual(undefined);
    await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
    expect(saved).toHaveLength(1);
  });

  it("persiste las rutas cada 30 s solo si hubo cambios", async () => {
    const { controller, made, persisted } = setup();
    controller.start();
    await controller.leaveManual(undefined);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(persisted).toHaveLength(0);
    made[0].log.add("a.ts");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].away?.watchedPaths).toEqual(["a.ts"]);
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 3);
    expect(persisted).toHaveLength(1);
  });

  it("returnNow cierra la ausencia sin esperar presencia ni avisar", async () => {
    const { controller, returned } = setup();
    controller.start();
    await controller.leaveManual(undefined);
    const session = await controller.returnNow();
    expect(session?.away?.endedAt).toBeDefined();
    expect(returned).toHaveLength(0);
    expect(controller.activeSession).toBeUndefined();
  });

  it("una sesión sin regreso que quedó de antes se cierra con la primera presencia", async () => {
    const { controller, returned } = setup();
    controller.restore(makeSession({ away: { startedAt: new Date(T0 - 3_600_000).toISOString(), watchedPaths: [], overflow: 0 } }));
    controller.start();
    controller.presence();
    await vi.advanceTimersByTimeAsync(0);
    expect(returned).toHaveLength(1);
  });

  it("una ráfaga de presencia cierra la ausencia una sola vez", async () => {
    const { controller, returned } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    controller.presence();
    controller.presence();
    controller.presence();
    await vi.advanceTimersByTimeAsync(0);
    expect(returned).toHaveLength(1);
  });

  it("dispose persiste lo grabado sin marcar el regreso", async () => {
    const { controller, made, persisted, returned } = setup();
    controller.start();
    await controller.leaveManual(undefined);
    made[0].log.add("a.ts");
    await controller.dispose();
    expect(persisted.at(-1)?.away).toMatchObject({ watchedPaths: ["a.ts"] });
    expect(persisted.at(-1)?.away?.endedAt).toBeUndefined();
    expect(returned).toHaveLength(0);
  });
});
