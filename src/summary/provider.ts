import { Session } from "../session/model";

export interface SummaryProvider {
  name: string; // "byok:openai" | "byok:anthropic" | "local:ollama"
  summarize(session: Session): Promise<string>;
}

export type SummaryProviderKind = "none" | "openai" | "anthropic" | "ollama";

/**
 * Lo único que se envía al proveedor es esto: el JSON de la sesión sin el
 * resumen previo. Como el modelo de sesión no contiene contenido de archivos
 * ni diffs, no se envía código.
 */
export function sessionForPrompt(session: Session): Omit<Session, "summary"> {
  const { summary: _summary, ...rest } = session;
  void _summary;
  return rest;
}

export function buildPrompt(template: string, session: Session): string {
  return template.replace("{session_json}", JSON.stringify(sessionForPrompt(session), null, 2));
}

export function cleanSummary(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export class SummaryError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = "SummaryError";
  }
}

/** Lee el cuerpo de una respuesta HTTP fallida sin explotar. */
export async function describeHttpError(response: Response): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    // ignorar
  }
  return `HTTP ${response.status}${body ? ` ${body}` : ""}`;
}
