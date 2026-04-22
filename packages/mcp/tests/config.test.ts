import { describe, expect, it } from 'vitest'

import { DEFAULT_BASE_URL, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('throws a clear error when TRULAYER_API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow(/TRULAYER_API_KEY/)
  })

  it('throws when TRULAYER_API_KEY is empty/whitespace', () => {
    expect(() => loadConfig({ TRULAYER_API_KEY: '   ' })).toThrow(/TRULAYER_API_KEY/)
  })

  it('uses the default base URL when TRULAYER_API_URL is not set', () => {
    const cfg = loadConfig({ TRULAYER_API_KEY: 'k' })
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(cfg.apiKey).toBe('k')
  })

  it('strips trailing slashes from TRULAYER_API_URL', () => {
    const cfg = loadConfig({ TRULAYER_API_KEY: 'k', TRULAYER_API_URL: 'http://localhost:8080//' })
    expect(cfg.baseUrl).toBe('http://localhost:8080')
  })
})
