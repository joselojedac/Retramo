import { randomBytes } from "node:crypto";

// Implementación mínima de ULID (https://github.com/ulid/spec) para no
// agregar una dependencia de runtime. 48 bits de tiempo + 80 bits aleatorios,
// codificados en Crockford base32. Ordenable lexicográficamente por tiempo.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let out = "";
  let value = time;
  for (let i = 0; i < 10; i++) {
    out = ENCODING[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += ENCODING[bytes[i] % 32];
  }
  return out;
}

export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom();
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
