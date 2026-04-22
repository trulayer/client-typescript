import { describe, expect, it } from 'vitest'

import { TruLayerApiError, formatApiError } from '../src/errors.js'

describe('formatApiError', () => {
  it('maps 401 to an auth-failure hint', () => {
    const msg = formatApiError(new TruLayerApiError(401, 'nope'))
    expect(msg).toMatch(/auth failed/)
    expect(msg).toMatch(/query_only/)
  })

  it('maps 403 to the same auth hint', () => {
    const msg = formatApiError(new TruLayerApiError(403, 'forbidden'))
    expect(msg).toMatch(/auth failed/)
  })

  it('maps 429 to a retry hint with the seconds value', () => {
    const msg = formatApiError(new TruLayerApiError(429, 'slow', 17))
    expect(msg).toMatch(/rate limit/)
    expect(msg).toMatch(/17 seconds/)
  })

  it('maps 429 without Retry-After to a default wait', () => {
    const msg = formatApiError(new TruLayerApiError(429, 'slow'))
    expect(msg).toMatch(/retry in 30 seconds/)
  })

  it('maps 5xx to safe-to-retry', () => {
    expect(formatApiError(new TruLayerApiError(500, 'x'))).toMatch(/safe to retry/)
    expect(formatApiError(new TruLayerApiError(503, 'x'))).toMatch(/safe to retry/)
  })

  it('maps 404 to not-found', () => {
    expect(formatApiError(new TruLayerApiError(404, 'missing'))).toMatch(/not found/)
  })

  it('maps other 4xx to a generic failed-request message', () => {
    expect(formatApiError(new TruLayerApiError(418, 'teapot'))).toMatch(/request failed: 418/)
  })
})
