import { Session } from "../session/model";
import {
  buildPrompt,
  cleanSummary,
  describeHttpError,
  SummaryError,
  SummaryProvider,
} from "./provider";
import type { Logger } from "../log";

const TIMEOUT_MS = 120_000; // los modelos locales pueden ser lentos

/**
 * Resumen con Ollama (u otro endpoint compatible con su API). Sin clave.
 * No hay ajuste para elegir el modelo (AGENTS.md §11): se usa el primero
 * que informe `/api/tags`, y queda anotado en el log cuál fue.
 */
export class OllamaProvider implements SummaryProvider {
  readonly name = "local:ollama";
  private model: string | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly promptTemplate: string,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async summarize(session: Session): Promise<string> {
    const model = await this.resolveModel();
    const response = await this.fetchImpl(`${this.base()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(this.promptTemplate, session),
        stream: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new SummaryError(this.name, await describeHttpError(response));
    }
    const data = (await response.json()) as { response?: string };
    if (!data.response) {
      throw new SummaryError(this.name, "respuesta sin contenido");
    }
    return cleanSummary(data.response);
  }

  private base(): string {
    return this.endpoint.replace(/\/+$/, "");
  }

  private async resolveModel(): Promise<string> {
    if (this.model) {
      return this.model;
    }
    const response = await this.fetchImpl(`${this.base()}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new SummaryError(this.name, await describeHttpError(response));
    }
    const data = (await response.json()) as { models?: { name: string }[] };
    const first = data.models?.[0]?.name;
    if (!first) {
      throw new SummaryError(this.name, "Ollama no tiene ningún modelo instalado");
    }
    this.log.info(`summary: usando el modelo local "${first}"`);
    this.model = first;
    return first;
  }
}
