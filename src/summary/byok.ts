import { Session } from "../session/model";
import {
  buildPrompt,
  cleanSummary,
  describeHttpError,
  SummaryError,
  SummaryProvider,
} from "./provider";

/**
 * Proveedores "bring your own key". Usan `fetch` directo en vez de un SDK
 * para no agregar dependencias de runtime (AGENTS.md §2). La clave viene de
 * `context.secrets`, nunca de settings.
 */

export const OPENAI_MODEL = "gpt-4o-mini";
export const ANTHROPIC_MODEL = "claude-opus-5";
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

export class OpenAIProvider implements SummaryProvider {
  readonly name = "byok:openai";

  constructor(
    private readonly apiKey: string,
    private readonly promptTemplate: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async summarize(session: Session): Promise<string> {
    const response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: buildPrompt(this.promptTemplate, session) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new SummaryError(this.name, await describeHttpError(response));
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new SummaryError(this.name, "respuesta sin contenido");
    }
    return cleanSummary(text);
  }
}

export class AnthropicProvider implements SummaryProvider {
  readonly name = "byok:anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly promptTemplate: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async summarize(session: Session): Promise<string> {
    const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: buildPrompt(this.promptTemplate, session) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new SummaryError(this.name, await describeHttpError(response));
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") {
      throw new SummaryError(this.name, "el modelo rechazó la solicitud");
    }
    const text = data.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    if (!text) {
      throw new SummaryError(this.name, "respuesta sin contenido");
    }
    return cleanSummary(text);
  }
}
