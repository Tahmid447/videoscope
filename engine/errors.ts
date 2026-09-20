export class ProviderError extends Error {
  constructor(public code: string, message: string, public status = 422, public retryable = false, public retryAfterMs = 0) { super(message); }
}
export function backoff(attempt: number, retryAfterMs = 0, random = Math.random): number {
  return Math.max(retryAfterMs, Math.min(60_000, 1000 * 2 ** attempt) * (0.75 + random() / 2));
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  return Math.max(0, /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : (Date.parse(value) || now) - now);
}
