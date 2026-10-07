/**
 * Un id de objeto de git completo: SHA-1 (40) o SHA-256 (64) en hexadecimal
 * minúscula. Todo hash que se lea de una sesión pasa por acá antes de llegar
 * a git, para que nunca se interprete como una opción (por ejemplo
 * "--output=/tmp/x").
 */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID.test(value);
}
