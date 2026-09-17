/**
 * Detector de inactividad, sin dependencia de vscode para poder testearlo.
 *
 * - `activity()` resetea el temporizador.
 * - Cuando vence, llama a `onIdle` una sola vez y queda desarmado hasta que
 *   haya actividad de nuevo: nunca dispara dos sesiones idle seguidas.
 * - `restart()` vuelve a leer la duración (por ejemplo tras un cambio de
 *   configuración) y rearma.
 */
export interface IdleDetectorOptions {
  /** Duración de inactividad en milisegundos. Se consulta al armar. */
  getIdleMs: () => number;
  onIdle: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export const MIN_IDLE_MINUTES = 5;
export const DEFAULT_IDLE_MINUTES = 20;

export function normalizeIdleMinutes(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_IDLE_MINUTES;
  return Math.max(MIN_IDLE_MINUTES, n);
}

export class IdleDetector {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private armed = false;
  private disposed = false;
  private firing = false;

  constructor(private readonly options: IdleDetectorOptions) {}

  get isArmed(): boolean {
    return this.armed;
  }

  start(): void {
    this.arm();
  }

  /** Hubo actividad del usuario: reiniciar la cuenta. */
  activity(): void {
    if (this.disposed || this.firing) {
      return;
    }
    this.arm();
  }

  /** Cambió la configuración: reiniciar con la nueva duración. */
  restart(): void {
    if (this.disposed) {
      return;
    }
    this.arm();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private arm(): void {
    this.clear();
    this.armed = true;
    this.timer = setTimeout(() => void this.fire(), this.options.getIdleMs());
  }

  private clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.armed = false;
  }

  private async fire(): Promise<void> {
    this.timer = undefined;
    this.armed = false;
    this.firing = true;
    try {
      await this.options.onIdle();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.firing = false;
    }
    // Queda desarmado: sólo `activity()` vuelve a armar.
  }
}
