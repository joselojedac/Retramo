import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IdleDetector, normalizeIdleMinutes } from "../../src/idle/detector";

describe("IdleDetector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dispara cuando vence el temporizador", async () => {
    const onIdle = vi.fn();
    const detector = new IdleDetector({ getIdleMs: () => 1000, onIdle });
    detector.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("la actividad resetea el temporizador", async () => {
    const onIdle = vi.fn();
    const detector = new IdleDetector({ getIdleMs: () => 1000, onIdle });
    detector.start();
    await vi.advanceTimersByTimeAsync(800);
    detector.activity();
    await vi.advanceTimersByTimeAsync(800);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("dispara una sola vez sin actividad en el medio", async () => {
    const onIdle = vi.fn();
    const detector = new IdleDetector({ getIdleMs: () => 1000, onIdle });
    detector.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(detector.isArmed).toBe(false);
    detector.activity();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it("la actividad durante la captura no rearma antes de terminar", async () => {
    let resolve!: () => void;
    const onIdle = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const detector = new IdleDetector({ getIdleMs: () => 1000, onIdle });
    detector.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    detector.activity(); // llega mientras onIdle sigue corriendo
    expect(detector.isArmed).toBe(false);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    detector.activity();
    expect(detector.isArmed).toBe(true);
  });

  it("restart usa la duración nueva", async () => {
    const onIdle = vi.fn();
    let ms = 1000;
    const detector = new IdleDetector({ getIdleMs: () => ms, onIdle });
    detector.start();
    ms = 5000;
    detector.restart();
    await vi.advanceTimersByTimeAsync(4999);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("los errores de onIdle van a onError y no rompen el detector", async () => {
    const onError = vi.fn();
    const detector = new IdleDetector({
      getIdleMs: () => 100,
      onIdle: async () => { throw new Error("x"); },
      onError,
    });
    detector.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledTimes(1);
    detector.activity();
    expect(detector.isArmed).toBe(true);
  });

  it("dispose cancela todo", async () => {
    const onIdle = vi.fn();
    const detector = new IdleDetector({ getIdleMs: () => 100, onIdle });
    detector.start();
    detector.dispose();
    detector.activity();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe("normalizeIdleMinutes", () => {
  it("aplica default y mínimo", () => {
    expect(normalizeIdleMinutes(undefined)).toBe(20);
    expect(normalizeIdleMinutes("x")).toBe(20);
    expect(normalizeIdleMinutes(NaN)).toBe(20);
    expect(normalizeIdleMinutes(1)).toBe(5);
    expect(normalizeIdleMinutes(45)).toBe(45);
  });
});
