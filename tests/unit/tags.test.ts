/**
 * Key → value tag tests.
 *
 * Verifies the SDK accepts structured tags via `options.tagMap` and
 * `TraceContext.setTag`, and that a non-empty tag map takes precedence
 * over the legacy string-array `tags` on the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer } from '../../src/client.js'
import type { TraceData } from '../../src/model.js'
import { traceToWire } from '../../src/model.js'

function captureEnqueued(tl: TruLayer): TraceData[] {
  const captured: TraceData[] = []
  vi.spyOn(tl._batch, 'enqueue').mockImplementation((t: TraceData) => {
    captured.push(t)
  })
  return captured
}

function makeClient(): TruLayer {
  return new TruLayer({ apiKey: 'tl_test', projectName: 'proj-tags' })
}

describe('tag map', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('options.tagMap is captured and sent as the `tags` wire field', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async () => {}, {
      tagMap: { env: 'prod', region: 'us-east-1' },
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]!.tag_map).toEqual({ env: 'prod', region: 'us-east-1' })

    const wire = traceToWire(captured[0]!)
    expect(wire.tags).toEqual({ env: 'prod', region: 'us-east-1' })
  })

  it('setTag appends individual tags to the map', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      trace.setTag('env', 'staging')
      trace.setTag('user_id', 'abc-123')
    })

    const wire = traceToWire(captured[0]!)
    expect(wire.tags).toEqual({ env: 'staging', user_id: 'abc-123' })
  })

  it('setTag overrides an earlier value for the same key', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      trace.setTag('env', 'staging')
      trace.setTag('env', 'prod')
    })

    const wire = traceToWire(captured[0]!)
    expect(wire.tags).toEqual({ env: 'prod' })
  })

  it('non-empty tag map takes precedence over legacy array `tags`', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      trace.addTag('legacy')
      trace.setTag('env', 'prod')
    }, { tags: ['from-options'] })

    const wire = traceToWire(captured[0]!)
    // Map form wins — the legacy array is still preserved in memory but
    // must not appear on the wire when the map is non-empty.
    expect(wire.tags).toEqual({ env: 'prod' })
    expect(Array.isArray(wire.tags)).toBe(false)
  })

  it('legacy string-array shape is preserved when no tag map is set', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      trace.addTag('beta')
      trace.addTag('dogfood')
    })

    const wire = traceToWire(captured[0]!)
    expect(wire.tags).toEqual(['beta', 'dogfood'])
    expect(Array.isArray(wire.tags)).toBe(true)
  })

  it('empty tag map does not shadow the legacy array', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      trace.addTag('beta')
    }, { tagMap: {} })

    const wire = traceToWire(captured[0]!)
    expect(wire.tags).toEqual(['beta'])
  })
})
