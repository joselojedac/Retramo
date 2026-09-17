import * as vscode from "vscode";
import { MAX_TERMINAL_COMMANDS, Session } from "../session/model";
import type { Logger } from "../log";

// `onDidStartTerminalShellExecution` existe desde VS Code 1.93. Como el
// mínimo declarado es 1.90, accedemos por un tipado local y comprobamos en
// runtime si está disponible.
interface ShellExecutionStartEvent {
  terminal: vscode.Terminal;
  execution: {
    commandLine: { value: string };
    cwd?: vscode.Uri;
  };
}
interface WindowWithShellIntegration {
  onDidStartTerminalShellExecution?: vscode.Event<ShellExecutionStartEvent>;
}

/**
 * Registra los últimos comandos ejecutados en la terminal integrada a medida
 * que ocurren. Nunca guarda la salida. Si la API no existe, `capture()`
 * devuelve `undefined`.
 */
export class TerminalTracker implements vscode.Disposable {
  private readonly commands: string[] = [];
  private lastCwd: string | undefined;
  private readonly subscription: vscode.Disposable | undefined;
  readonly available: boolean;

  constructor(log: Logger) {
    const event = (vscode.window as unknown as WindowWithShellIntegration).onDidStartTerminalShellExecution;
    this.available = typeof event === "function";
    if (!this.available) {
      log.warn("terminal: onDidStartTerminalShellExecution no disponible (VS Code < 1.93); no se capturan comandos");
      return;
    }
    this.subscription = event!((e) => this.record(e));
  }

  /** Expuesto para tests: registra un comando como si lo hubiera lanzado la terminal. */
  push(commandLine: string, cwd?: string): void {
    const trimmed = commandLine.trim();
    if (!trimmed) {
      return;
    }
    this.commands.push(trimmed);
    while (this.commands.length > MAX_TERMINAL_COMMANDS) {
      this.commands.shift();
    }
    if (cwd) {
      this.lastCwd = cwd;
    }
  }

  async capture(): Promise<Session["terminal"]> {
    if (!this.available || this.commands.length === 0) {
      return undefined;
    }
    const result: NonNullable<Session["terminal"]> = { recentCommands: [...this.commands] };
    if (this.lastCwd) {
      result.cwd = this.lastCwd;
    }
    return result;
  }

  dispose(): void {
    this.subscription?.dispose();
  }

  private record(e: ShellExecutionStartEvent): void {
    try {
      this.push(e.execution.commandLine.value, e.execution.cwd?.fsPath);
    } catch {
      // Un evento malformado no debe romper nada.
    }
  }
}
