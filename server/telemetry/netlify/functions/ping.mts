import type { Config } from "@netlify/functions";
import { countsStore, isoWeek, parsePing } from "../lib/telemetry.mts";

/**
 * POST /ping  { installId, returnCount, version }
 *
 * Guarda sólo eso, bajo la semana ISO. No guarda IP, user agent ni nada más.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  }
  const raw = await req.text();
  if (raw.length > 1024) {
    return new Response("Payload Too Large", { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const ping = parsePing(body);
  if (!ping) {
    return new Response("Bad Request", { status: 400 });
  }

  const store = countsStore();
  const key = `${isoWeek(new Date())}/${ping.installId}`;
  const previous = (await store.get(key, { type: "json" })) as { returnCount: number } | null;
  await store.setJSON(key, {
    returnCount: (previous?.returnCount ?? 0) + ping.returnCount,
    version: ping.version,
  });
  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: "/ping",
};
