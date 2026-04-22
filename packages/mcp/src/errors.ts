/**
 * Error mapping for HTTP responses from the TruLayer API.
 *
 * Maps low-level HTTP errors to agent-readable messages that hint at the
 * next action (fix the key, wait and retry, safe to retry).
 */

export class TruLayerApiError extends Error {
  public readonly statusCode: number
  public readonly retryAfterSeconds: number | undefined

  constructor(statusCode: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'TruLayerApiError'
    this.statusCode = statusCode
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function formatApiError(err: TruLayerApiError): string {
  if (err.statusCode === 401 || err.statusCode === 403) {
    return 'auth failed; check TRULAYER_API_KEY and ensure the key has query_only scope'
  }
  if (err.statusCode === 429) {
    const wait = err.retryAfterSeconds ?? 30
    return `rate limit; retry in ${wait} seconds`
  }
  if (err.statusCode >= 500) {
    return 'server error; safe to retry'
  }
  if (err.statusCode === 404) {
    return `not found (${err.message})`
  }
  return `request failed: ${err.statusCode} ${err.message}`
}
