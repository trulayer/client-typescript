/**
 * Typed errors raised by the TruLayer SDK.
 *
 * The SDK is designed to never throw into user application code at runtime —
 * batch sender failures are logged via `console.warn`. These error types are
 * provided so that callers who want to observe and react to specific,
 * non-retryable failure modes (e.g. a misconfigured API key) can do so.
 */

/**
 * Raised when the TruLayer API rejects a request with HTTP 401 and an error
 * code of `invalid_api_key` or `api_key_expired`. These are permanent
 * configuration errors — retrying with the same credentials has no chance of
 * succeeding, so the SDK halts pending and future requests for the lifetime
 * of the client instance.
 *
 * Recommended handling: catch during `init()` smoke requests, log the failure,
 * and surface an actionable message to the operator.
 */
export class InvalidAPIKeyError extends Error {
  /** Discriminator for `instanceof`-unfriendly environments (e.g. dual-bundle). */
  override readonly name = 'InvalidAPIKeyError'
  /** The machine-readable error code returned by the API. */
  readonly code: 'invalid_api_key' | 'api_key_expired'

  constructor(code: 'invalid_api_key' | 'api_key_expired') {
    super('API key is invalid or has expired — check your configuration.')
    this.code = code
    // Restore prototype chain when compiled to ES5
    Object.setPrototypeOf(this, InvalidAPIKeyError.prototype)
  }
}

/**
 * Raised when the batch sender fails to deliver a batch of traces after
 * exhausting retries **and** the operator has opted in to block-on-failure
 * behavior via `TRULAYER_FAIL_MODE=block` (or the equivalent constructor
 * option).
 *
 * Default SDK behavior is drop-and-warn — this error only surfaces when
 * the caller has explicitly requested blocking semantics, typically on a
 * critical path where losing traces silently is worse than bubbling an
 * error back to user code.
 */
export class TruLayerFlushError extends Error {
  /** Discriminator for `instanceof`-unfriendly environments. */
  override readonly name = 'TruLayerFlushError'
  /** Number of traces in the failed batch. */
  readonly batchSize: number

  constructor(message: string, batchSize: number, cause?: unknown) {
    super(message)
    this.batchSize = batchSize
    // `Error.cause` landed in ES2022; ES2020 lib doesn't know about it, so
    // assign via indexed access to avoid widening the tsconfig target.
    if (cause !== undefined) {
      ;(this as unknown as { cause?: unknown }).cause = cause
    }
    Object.setPrototypeOf(this, TruLayerFlushError.prototype)
  }
}

/**
 * Returns true when a JSON error payload represents a non-retryable API key
 * failure. Accepts either an `error` or `code` field for forward compatibility.
 */
export function isInvalidAPIKeyPayload(
  body: unknown,
): { code: 'invalid_api_key' | 'api_key_expired' } | null {
  if (body === null || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const raw = obj['error'] ?? obj['code']
  if (raw === 'invalid_api_key' || raw === 'api_key_expired') {
    return { code: raw }
  }
  return null
}
