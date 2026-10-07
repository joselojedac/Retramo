import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PresenceFilter, SCROLL_WINDOW_MS } from "../../src/idle/presence";
import { IdleDetector } from "../../src/idle/detector";

// Las secuencias replican lo medido en VS Code con teclado y mouse reales
// (xdotool) y con un agente que edita desde una extensión.

describe("PresenceFilter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const onPresence = vi.fn();
    const filter = new PresenceFilter({ onPresence });
    return { onPresence, filter };
  }

  it("escribir letras y usar flechas (Keyboard) es presencia", () => {
    const { onPresence, filter } = setup();
    filter.nonHuman(); // cambio de documento por la tecla
    filter.selection("keyboard", true);
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("un clic (Mouse) es presencia", () => {
    const { onPresence, filter } = setup();
    filter.selection("mouse", true);
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("Keyboard o Mouse sin la ventana enfocada no cuentan", () => {
    const { onPresence, filter } = setup();
    filter.selection("keyboard", false);
    filter.selection("mouse", false);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it("un agente editando (documento + selección undefined + Command) no es presencia", async () => {
    const { onPresence, filter } = setup();
    filter.nonHuman(); // docChange
    filter.selection("unknown", true);
    filter.visibleRanges(true); // revealRange
    filter.selection("command", true);
    await vi.advanceTimersByTimeAsync(SCROLL_WINDOW_MS * 4);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it("la rueda del mouse sola es presencia", async () => {
    const { onPresence, filter } = setup();
    filter.visibleRanges(true);
    filter.visibleRanges(true);
    expect(onPresence).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SCROLL_WINDOW_MS);
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("un archivo abierto por un proceso externo (scroll + Command) no es presencia", async () => {
    const { onPresence, filter } = setup();
    filter.visibleRanges(true);
    filter.selection("command", true); // llega justo después del scroll
    filter.visibleRanges(true);
    await vi.advanceTimersByTimeAsync(SCROLL_WINDOW_MS * 4);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it("scroll con la ventana sin foco no cuenta", async () => {
    const { onPresence, filter } = setup();
    filter.visibleRanges(false);
    await vi.advanceTimersByTimeAsync(SCROLL_WINDOW_MS * 2);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it("ganar el foco de la ventana es presencia; perderlo no", () => {
    const { onPresence, filter } = setup();
    filter.windowState(false, false);
    expect(onPresence).not.toHaveBeenCalled();
    filter.windowState(true, false);
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("la ventana que queda inactiva con el foco puesto NO es presencia (el evento de los ~60 s)", () => {
    const { onPresence, filter } = setup();
    filter.windowState(true, false); // medido: focused=true, active=false, sin que nadie toque nada
    filter.windowState(true, false);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it("escribir en la terminal (active pasa a true) es presencia", () => {
    const { onPresence, filter } = setup();
    filter.windowState(true, false); // inactiva
    filter.windowState(true, true); // medido: una tecla en la terminal
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("un comando en la terminal activa con foco es presencia; en otra terminal no", () => {
    const { onPresence, filter } = setup();
    filter.shellExecution(false, true);
    filter.shellExecution(true, false);
    expect(onPresence).not.toHaveBeenCalled();
    filter.shellExecution(true, true);
    expect(onPresence).toHaveBeenCalledTimes(1);
  });

  it("después de dispose no avisa nada", async () => {
    const { onPresence, filter } = setup();
    filter.visibleRanges(true);
    filter.dispose();
    filter.selection("keyboard", true);
    await vi.advanceTimersByTimeAsync(SCROLL_WINDOW_MS * 2);
    expect(onPresence).not.toHaveBeenCalled();
  });
});

describe("inactividad con un agente trabajando", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("una ventana enfocada pero sin tocar no reinicia el temporizador", async () => {
    const onIdle = vi.fn();
    const idle = new IdleDetector({ getIdleMs: () => 5 * 60_000, onIdle });
    const filter = new PresenceFilter({ onPresence: () => idle.activity() });
    idle.start();
    await vi.advanceTimersByTimeAsync(60_000);
    filter.windowState(true, false); // lo que VS Code manda a los ~60 s
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("las ediciones de un agente no reinician el temporizador", async () => {
    const onIdle = vi.fn();
    const idle = new IdleDetector({ getIdleMs: () => 20 * 60_000, onIdle });
    const filter = new PresenceFilter({ onPresence: () => idle.activity() });
    idle.start();
    // El agente edita cada 30 segundos durante 25 minutos.
    for (let t = 0; t < 25 * 60_000; t += 30_000) {
      filter.nonHuman();
      filter.selection("unknown", true);
      filter.selection("command", true);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("escribir sí reinicia el temporizador", async () => {
    const onIdle = vi.fn();
    const idle = new IdleDetector({ getIdleMs: () => 20 * 60_000, onIdle });
    const filter = new PresenceFilter({ onPresence: () => idle.activity() });
    idle.start();
    for (let t = 0; t < 25 * 60_000; t += 60_000) {
      filter.selection("keyboard", true);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(onIdle).not.toHaveBeenCalled();
  });
});
