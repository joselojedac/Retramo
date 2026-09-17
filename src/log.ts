/**
 * Logger de la extensión. Todo lo que falla de forma no bloqueante
 * termina acá, nunca en un popup para el usuario (principio 6).
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface LogSink {
  appendLine(value: string): void;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export function createLogger(sink: LogSink): Logger {
  const line = (level: string, message: string): void => {
    sink.appendLine(`[${new Date().toISOString()}] [${level}] ${message}`);
  };
  return {
    info: (message) => line("info", message),
    warn: (message) => line("warn", message),
    error: (message, error) =>
      line("error", error === undefined ? message : `${message}: ${describe(error)}`),
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
