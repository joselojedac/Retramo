import { getDeployStore, getStore } from "@netlify/blobs";

/** Producción usa el store global; previews y dev, uno por deploy, para no mezclar datos de prueba. */
export function countsStore() {
  return Netlify.context?.deploy.context === "production" ? getStore("counts") : getDeployStore("counts");
}

/** Semana ISO en formato 2026-W38. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface Ping {
  installId: string;
  returnCount: number;
  version: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d+\.\d+\.\d+[0-9A-Za-z.-]{0,20}$/;

/** Acepta exactamente { installId, returnCount, version }. Cualquier otra cosa se rechaza. */
export function parsePing(body: unknown): Ping | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "installId,returnCount,version") {
    return undefined;
  }
  const { installId, returnCount, version } = body as Record<string, unknown>;
  if (typeof installId !== "string" || !UUID.test(installId)) {
    return undefined;
  }
  if (typeof returnCount !== "number" || !Number.isInteger(returnCount) || returnCount < 0 || returnCount > 10_000) {
    return undefined;
  }
  if (typeof version !== "string" || !VERSION.test(version)) {
    return undefined;
  }
  return { installId, returnCount, version };
}
