import { describe, it, expect } from "vitest";
import { AnthropicProvider, ANTHROPIC_MODEL } from "../../src/summary/byok";
import { buildPayload, SummaryError } from "../../src/summary/provider";
import { makeSession } from "./helpers";

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const payload = buildPayload(makeSession({ intent: "esperando al agente" }));

describe("AnthropicProvider", () => {
  it("manda el request vigente: modelo, fallbacks por defecto, esfuerzo bajo, sin la clave en el cuerpo", async () => {
    const { calls, fetchImpl } = fakeFetch({ stop_reason: "end_turn", content: [{ type: "text", text: "Resumen." }] });
    const text = await new AnthropicProvider("sk-ant-test", "Data:\n{payload_json}", fetchImpl).summarize(payload);
    expect(text).toBe("Resumen.");
    const { url, init } = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(ANTHROPIC_MODEL);
    expect(body.fallbacks).toBe("default");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.messages[0].content).toContain("esperando al agente");
    expect(String(init.body)).not.toContain("sk-ant-test");
  });

  it("solo toma los bloques de texto (ignora thinking y fallback)", async () => {
    const { fetchImpl } = fakeFetch({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "fallback", from: { model: "a" }, to: { model: "b" } },
        { type: "text", text: "Primera." },
        { type: "text", text: "Segunda." },
      ],
    });
    expect(await new AnthropicProvider("k", "{payload_json}", fetchImpl).summarize(payload)).toBe("Primera.\nSegunda.");
  });

  it("un rechazo no se muestra como resumen, aunque traiga texto parcial", async () => {
    const { fetchImpl } = fakeFetch({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
      content: [{ type: "text", text: "parcial" }],
    });
    await expect(new AnthropicProvider("k", "{payload_json}", fetchImpl).summarize(payload)).rejects.toThrow(/rechazó.*cyber/);
  });

  it("un corte por max_tokens no se muestra como resumen", async () => {
    const { fetchImpl } = fakeFetch({ stop_reason: "max_tokens", content: [{ type: "text", text: "a medias" }] });
    await expect(new AnthropicProvider("k", "{payload_json}", fetchImpl).summarize(payload)).rejects.toBeInstanceOf(SummaryError);
  });

  it("un error HTTP se informa con el código", async () => {
    const { fetchImpl } = fakeFetch({ type: "error", error: { type: "authentication_error" } }, 401);
    await expect(new AnthropicProvider("k", "{payload_json}", fetchImpl).summarize(payload)).rejects.toThrow(/HTTP 401/);
  });
});
