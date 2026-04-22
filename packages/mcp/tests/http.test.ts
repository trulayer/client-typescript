import { describe, expect, it, vi } from 'vitest'

import { TruLayerApiError } from '../src/errors.js'
import { HttpClient } from '../src/http.js'

function mockFetch(responder: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    return responder(url, init ?? {})
  }) as unknown as typeof fetch
}

describe('HttpClient', () => {
  it('sends Authorization, User-Agent, and serializes query params', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url.pathname).toBe('/v1/traces')
      expect(url.searchParams.get('project_id')).toBe('p1')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.has('cursor')).toBe(false) // undefined dropped
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer test-key')
      expect(headers.get('user-agent')).toMatch(/^trulayer-mcp\//)
      return new Response(JSON.stringify({ traces: [], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new HttpClient({
      baseUrl: 'https://api.trulayer.ai',
      apiKey: 'test-key',
      fetchImpl,
    })
    const result = await client.get({
      path: '/v1/traces',
      query: { project_id: 'p1', limit: 10, cursor: undefined },
    })
    expect(result).toEqual({ traces: [], has_more: false })
  })

  it('maps 401 to a TruLayerApiError with the status code', async () => {
    const fetchImpl = mockFetch(
      () =>
        new Response('unauthorized', {
          status: 401,
        }),
    )
    const client = new HttpClient({ baseUrl: 'https://x', apiKey: 'k', fetchImpl })
    await expect(client.get({ path: '/v1/metrics' })).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('captures Retry-After seconds on 429', async () => {
    const fetchImpl = mockFetch(
      () =>
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '42' },
        }),
    )
    const client = new HttpClient({ baseUrl: 'https://x', apiKey: 'k', fetchImpl })
    try {
      await client.get({ path: '/v1/traces' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TruLayerApiError)
      const e = err as TruLayerApiError
      expect(e.statusCode).toBe(429)
      expect(e.retryAfterSeconds).toBe(42)
    }
  })

  it('propagates 5xx as a retriable error', async () => {
    const fetchImpl = mockFetch(() => new Response('boom', { status: 503 }))
    const client = new HttpClient({ baseUrl: 'https://x', apiKey: 'k', fetchImpl })
    await expect(client.get({ path: '/v1/metrics' })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('normalizes baseUrl trailing slashes', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.toString()).toBe('https://api.trulayer.ai/v1/metrics')
      return new Response('{}', { status: 200 })
    })
    const client = new HttpClient({
      baseUrl: 'https://api.trulayer.ai///',
      apiKey: 'k',
      fetchImpl,
    })
    await client.get({ path: '/v1/metrics' })
  })
})
