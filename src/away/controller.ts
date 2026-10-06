import { IdleDetector } from "../idle/detector";
import { Baseline, Session, SessionTrigger } from "../session/model";
import type { Logger } from "../log";
import { AwayLog } from "./log";

/** Sin presencia durante este tiempo se toma una línea de base candidata. */
export const QUIET_MS = 2 * 60_000;
/** Tras "I'm leaving", la actividad de este lapso es el usuario yéndose, no volviendo. */
export const GRACE_MS = 60_000;
/** Cada cuánto se persisten las rutas del watcher durante la ausencia. */
export const FLUSH_MS = 30_000;

/** Lo que se graba durante una ausencia: línea de base y watcher. */
export interface AwayRecording {
  baseline?: Baseline;
  log: AwayLog;
  stop(): void;
}

export interface SaveInput {
  trigger: SessionTrigger;
  intent?: string;
  baseline?: Baseline;
  away: NonNullable<Session["away"]>;
}

export interface AwayDeps {
  idleMs(): number;
  /** Toma la línea de base y arranca el watcher. `undefined` sin carpeta abierta. */
  startRecording(): Promise<AwayRecording | undefined>;
  /** Captura editor, git y terminal, y guarda la sesión. */
  saveSession(input: SaveInput): Promise<Session | undefined>;
  persist(session: Session): Promise<void>;
  onReturn(session: Session): void | Promise<void>;
  log: Logger;
  now?: () => number;
  quietMs?: number;
  graceMs?: number;
  flushMs?: number;
}

interface Active {
  session: Session;
  recording?: AwayRecording;
  graceUntil: number;
  flushedRevision: number;
}

/**
 * Ciclo de una ausencia:
 *
 * 1. Sin presencia durante QUIET_MS se toma una línea de base candidata y
 *    arranca el watcher. Si la captura automática esperara a los 20 minutos,
 *    todo lo que un agente hizo en esos 20 minutos quedaría dentro de la
 *    línea de base y "mientras no estabas" lo perdería.
 * 2. Si vuelve la presencia antes de la inactividad, la candidata se descarta.
 * 3. Al vencer la inactividad, la sesión automática usa la candidata, y la
 *    ausencia empieza en la última presencia.
 * 4. "I'm leaving" toma la línea de base en el momento y deja un período de
 *    gracia: el usuario todavía se está yendo.
 * 5. La primera presencia después de eso es el regreso.
 *
 * Nunca hay dos sesiones automáticas sin presencia en el medio.
 */
export class AwayController {
  private readonly now: () => number;
  private readonly quiet: IdleDetector;
  private readonly idle: IdleDetector;
  private lastPresenceAt: number;
  private candidate: { recording?: AwayRecording; startedAt: number } | undefined;
  private active: Active | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(private readonly deps: AwayDeps) {
    this.now = deps.now ?? Date.now;
    this.lastPresenceAt = this.now();
    this.quiet = new IdleDetector({
      getIdleMs: () => deps.quietMs ?? QUIET_MS,
      onIdle: () => this.captureCandidate(),
      onError: (error) => deps.log.error("away: falló la línea de base candidata", error),
    });
    this.idle = new IdleDetector({
      getIdleMs: () => deps.idleMs(),
      onIdle: () => this.autoLeave(),
      onError: (error) => deps.log.error("away: falló la captura automática", error),
    });
  }

  start(): void {
    this.quiet.start();
    this.idle.start();
  }

  /** Cambió `retramo.idleMinutes`. */
  restartIdle(): void {
    this.idle.restart();
  }

  get activeSession(): Session | undefined {
    return this.active?.session;
  }

  presence(): void {
    if (this.disposed) {
      return;
    }
    const now = this.now();
    if (this.active) {
      if (now < this.active.graceUntil) {
        return; // todavía se está yendo
      }
      void this.endAway();
    }
    this.lastPresenceAt = now;
    this.discardCandidate();
    this.quiet.activity();
    this.idle.activity();
  }

  async leaveManual(intent: string | undefined): Promise<Session | undefined> {
    this.discardCandidate();
    if (this.active) {
      await this.finishActive(false);
    }
    const startedAt = this.now();
    const recording = await this.deps.startRecording();
    const session = await this.deps.saveSession({
      trigger: "manual",
      intent,
      baseline: recording?.baseline,
      away: { startedAt: new Date(startedAt).toISOString(), watchedPaths: [], overflow: 0 },
    });
    if (!session) {
      recording?.stop();
      return undefined;
    }
    this.activate(session, recording, startedAt + (this.deps.graceMs ?? GRACE_MS));
    return session;
  }

  /** "I'm back" a mano: cierra la ausencia activa, si hay, sin esperar presencia. */
  async returnNow(): Promise<Session | undefined> {
    return this.active ? this.endAway(false) : undefined;
  }

  /** Al arrancar: una sesión guardada sin regreso sigue siendo una ausencia abierta. */
  restore(session: Session): void {
    if (!this.active && session.away && !session.away.endedAt) {
      this.activate(session, undefined, this.now());
    }
  }

  /** Persiste lo grabado sin cerrar la ausencia (VS Code se cierra). */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.quiet.dispose();
    this.idle.dispose();
    this.discardCandidate();
    this.stopFlush();
    if (this.active) {
      const { session, recording } = this.active;
      this.active = undefined;
      recording?.stop();
      if (recording) {
        Object.assign(session.away ?? {}, recording.log.snapshot());
        await this.deps.persist(session).catch((error) => this.deps.log.error("away: no se pudo persistir al cerrar", error));
      }
    }
  }

  private async captureCandidate(): Promise<void> {
    if (this.active || this.candidate || this.disposed) {
      return;
    }
    const presenceBefore = this.lastPresenceAt;
    const recording = await this.deps.startRecording();
    if (this.lastPresenceAt !== presenceBefore || this.active || this.disposed) {
      recording?.stop(); // volvió mientras se capturaba
      return;
    }
    this.candidate = { recording, startedAt: presenceBefore };
  }

  private async autoLeave(): Promise<void> {
    if (this.active || this.disposed) {
      return;
    }
    const candidate = this.candidate ?? { recording: await this.deps.startRecording(), startedAt: this.lastPresenceAt };
    this.candidate = undefined;
    const session = await this.deps.saveSession({
      trigger: "idle",
      baseline: candidate.recording?.baseline,
      away: {
        startedAt: new Date(candidate.startedAt).toISOString(),
        ...(candidate.recording?.log.snapshot() ?? { watchedPaths: [], overflow: 0 }),
      },
    });
    if (!session) {
      candidate.recording?.stop();
      return;
    }
    this.activate(session, candidate.recording, this.now());
  }

  private activate(session: Session, recording: AwayRecording | undefined, graceUntil: number): void {
    this.active = { session, recording, graceUntil, flushedRevision: recording?.log.revision ?? 0 };
    this.stopFlush();
    if (recording) {
      this.flushTimer = setInterval(() => void this.flush(), this.deps.flushMs ?? FLUSH_MS);
    }
  }

  private async flush(): Promise<void> {
    const active = this.active;
    if (!active?.recording || active.recording.log.revision === active.flushedRevision) {
      return;
    }
    active.flushedRevision = active.recording.log.revision;
    Object.assign(active.session.away ?? {}, active.recording.log.snapshot());
    await this.deps.persist(active.session).catch((error) => this.deps.log.error("away: no se pudo persistir", error));
  }

  private async endAway(notify = true): Promise<Session | undefined> {
    const session = await this.finishActive(true);
    if (session && notify) {
      await this.deps.onReturn(session);
    }
    return session;
  }

  /** Cierra la ausencia activa: detiene el watcher y guarda las rutas y el fin. */
  private async finishActive(markEnded: boolean): Promise<Session | undefined> {
    const active = this.active;
    if (!active) {
      return undefined;
    }
    this.active = undefined; // primero, para que una ráfaga de presencia no cierre dos veces
    this.stopFlush();
    active.recording?.stop();
    const away = active.session.away;
    if (away) {
      if (active.recording) {
        Object.assign(away, active.recording.log.snapshot());
      }
      if (markEnded) {
        away.endedAt = new Date(this.now()).toISOString();
      }
    }
    await this.deps.persist(active.session).catch((error) => this.deps.log.error("away: no se pudo persistir el regreso", error));
    return active.session;
  }

  private discardCandidate(): void {
    this.candidate?.recording?.stop();
    this.candidate = undefined;
  }

  private stopFlush(): void {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
