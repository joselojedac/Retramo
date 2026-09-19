import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { countsStore } from "../lib/telemetry.mts";

/**
 * GET /stats  con  Authorization: Bearer <STATS_TOKEN>
 *
 * Devuelve, por semana ISO: instalaciones que reportaron, total de "Volví" y promedio.
 */
export default async (req: Request) => {
  const expected = Netlify.env.get("STATS_TOKEN");
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const store = countsStore();
  const { blobs } = await store.list();
  const weeks = new Map<string, { installs: number; returns: number; versions: Record<string, number> }>();
  for (const { key } of blobs) {
    const week = key.split("/")[0];
    const entry = (await store.get(key, { type: "json" })) as { returnCount: number; version: string } | null;
    if (!entry) {
      continue;
    }
    const w = weeks.get(week) ?? { installs: 0, returns: 0, versions: {} };
    w.installs += 1;
    w.returns += entry.returnCount;
    w.versions[entry.version] = (w.versions[entry.version] ?? 0) + 1;
    weeks.set(week, w);
  }
  const result = [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, w]) => ({
      week,
      installs: w.installs,
      returns: w.returns,
      averagePerInstall: w.installs ? Math.round((w.returns / w.installs) * 10) / 10 : 0,
      versions: w.versions,
    }));
  return Response.json(result);
};

export const config: Config = {
  path: "/stats",
};
