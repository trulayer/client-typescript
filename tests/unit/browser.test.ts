import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initBrowser } from '../../src/browser.js'
import type { BrowserConfig } from '../../src/browser.js'

function makeConfig(overrides?: Partial<BrowserConfig>): BrowserConfig {
  return {
    apiKey: 'tl_browser_unused',
    projectName: 'proj-browser',
    relayUrl: '/api/trulayer',
    ...overrides,
  }
}

describe('initBrowser', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws if relayUrl is missing', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initBrowser({ apiKey: 'tl_test', projectName: 'p', relayUrl: '' } as any),
    ).toThrow('relayUrl is required in browser mode')
  })

  it('throws with helpful message mentioning /api/trulayer', () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initBrowser({ apiKey: 'tl_test', projectName: 'p', relayUrl: '' } as any)
    } catch (err) {
      expect(String(err)).toContain('/api/trulayer')
    }
  })

  it('returns a TruLayer instance when relayUrl is set', () => {
    const tl = initBrowser(makeConfig())
    expect(tl).toBeDefined()
    expect(tl.projectName).toBe('proj-browser')
  })

  it('batch sender uses relayUrl as the POST target', async () => {
    const tl = initBrowser(makeConfig({ relayUrl: '/my-relay' }))
    await tl.trace('test-trace', async (t) => {
      t.setInput('hello')
    })
    // Flush to trigger the sender
    await tl.shutdown()

    const fetchMock = vi.mocked(fetch)
    // Find the call that posts to the relay (batch send)
    const batchCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/my-relay' && (call[1] as RequestInit)?.method === 'POST',
    )
    expect(batchCall).toBeDefined()
    expect(batchCall![0]).toBe('/my-relay')
  })

  it('does not send Authorization header from browser sender', async () => {
    const tl = initBrowser(makeConfig({ relayUrl: '/relay' }))
    await tl.trace('t', async () => {})
    await tl.shutdown()

    const fetchMock = vi.mocked(fetch)
    const batchCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/relay' && (call[1] as RequestInit)?.method === 'POST',
    )
    expect(batchCall).toBeDefined()
    const headers = (batchCall![1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('sets credentials: include on fetch calls', async () => {
    const tl = initBrowser(makeConfig({ relayUrl: '/relay' }))
    await tl.trace('t', async () => {})
    await tl.shutdown()

    const fetchMock = vi.mocked(fetch)
    const batchCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/relay' && (call[1] as RequestInit)?.method === 'POST',
    )
    expect(batchCall).toBeDefined()
    expect((batchCall![1] as RequestInit).credentials).toBe('include')
  })

  it('trace runs callback and returns result', async () => {
    const tl = initBrowser(makeConfig())
    const result = await tl.trace('my-trace', async (t) => {
      t.setInput('in')
      t.setOutput('out')
      return 42
    })
    expect(result).toBe(42)
  })

  it('feedback routes through relay without Authorization', async () => {
    const tl = initBrowser(makeConfig({ relayUrl: '/relay' }))
    tl.feedback('trace-1', 'good', { score: 1 })
    await new Promise((r) => setTimeout(r, 10))

    const fetchMock = vi.mocked(fetch)
    const feedbackCall = fetchMock.mock.calls.find((call) => {
      const body = (call[1] as RequestInit)?.body
      return typeof body === 'string' && body.includes('"feedback"')
    })
    expect(feedbackCall).toBeDefined()
    expect(feedbackCall![0]).toBe('/relay')
    const init = feedbackCall![1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
    expect(init.credentials).toBe('include')
  })
})
