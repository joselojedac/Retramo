/**
 * Decide qué eventos del editor son actividad humana. Sin dependencia de
 * vscode para poder testearlo.
 *
 * Medido con teclado y mouse reales contra un agente que edita desde una
 * extensión (WorkspaceEdit, revealRange, selección programática):
 *
 * - Escribir letras y mover el cursor con flechas: selección `Keyboard`.
 * - Clic en el editor: selección `Mouse`.
 * - Rueda del mouse: solo cambio de rango visible.
 * - Un agente editando: cambio de documento y selección `undefined` o
 *   `Command`. Nunca `Keyboard` ni `Mouse`.
 * - Abrir o cambiar de editor (humano o agente): cambio de editor activo,
 *   selección `undefined` y a veces cambio de rango visible.
 *
 * Por eso:
 * - `Keyboard` y `Mouse` con la ventana enfocada son presencia.
 * - El cambio de rango visible es presencia solo si ninguna señal no humana
 *   aparece en la ventana de `scrollWindowMs` antes o después: así cuenta la
 *   rueda del mouse y no un archivo que abrió un agente.
 * - Ganar el foco de la ventana es presencia.
 * - Un comando en la terminal activa, con la ventana enfocada, es presencia.
 * - Backspace y Enter reportan `undefined`: no cuentan. Nadie pasa 20
 *   minutos escribiendo sin una letra ni una flecha.
 */
export type SelectionKind = "keyboard" | "mouse" | "command" | "unknown";

export interface PresenceOptions {
  onPresence: () => void;
  now?: () => number;
  scrollWindowMs?: number;
}

export const SCROLL_WINDOW_MS = 500;

export class PresenceFilter {
  private lastNonHumanAt = Number.NEGATIVE_INFINITY;
  private pendingScroll: { at: number; timer: ReturnType<typeof setTimeout> } | undefined;
  private disposed = false;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(private readonly options: PresenceOptions) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.scrollWindowMs ?? SCROLL_WINDOW_MS;
  }

  selection(kind: SelectionKind, windowFocused: boolean): void {
    if (kind === "keyboard" || kind === "mouse") {
      if (windowFocused) {
        this.presence();
      }
      return;
    }
    this.nonHuman();
  }

  visibleRanges(windowFocused: boolean): void {
    if (this.disposed || !windowFocused || this.pendingScroll) {
      return;
    }
    const at = this.now();
    if (at - this.lastNonHumanAt < this.windowMs) {
      return;
    }
    // Esperar: si una señal no humana llega justo después, era un agente.
    const timer = setTimeout(() => {
      const pending = this.pendingScroll;
      this.pendingScroll = undefined;
      if (pending && this.lastNonHumanAt < pending.at) {
        this.presence();
      }
    }, this.windowMs);
    this.pendingScroll = { at, timer };
  }

  /** Cambio de editor activo, edición de documento o selección no humana. */
  nonHuman(): void {
    this.lastNonHumanAt = this.now();
    if (this.pendingScroll) {
      clearTimeout(this.pendingScroll.timer);
      this.pendingScroll = undefined;
    }
  }

  windowFocus(focused: boolean): void {
    if (focused) {
      this.presence();
    }
  }

  shellExecution(inActiveTerminal: boolean, windowFocused: boolean): void {
    if (inActiveTerminal && windowFocused) {
      this.presence();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.pendingScroll) {
      clearTimeout(this.pendingScroll.timer);
      this.pendingScroll = undefined;
    }
  }

  private presence(): void {
    if (!this.disposed) {
      this.options.onPresence();
    }
  }
}
