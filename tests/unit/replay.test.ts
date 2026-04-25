import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalBatchSender } from '../../src/local-batch.js'
import { replay } from '../../src/replay.js'
import { createTestClient } from '../../src/testing.js'
import { TruLayer } from '../../src/client.js'
import type { TraceData, SpanData } from '../../src/model.js'

describe('LocalBatchSender.flushToFile + replay', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trulayer-replay-'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
    TruLayer._localWarned = false
  })

  it('flushToFile writes one JSON object per line', async () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    sender.enqueue(makeTrace('t-2', [makeSpan('s-2', 't-2'), makeSpan('s-3', 't-2')]))

    const path = join(dir, 'out.jsonl')
    await sender.flushToFile(path)

    const body = await readFile(path, 'utf8')
    const lines = body.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] as string).id).toBe('t-1')
    expect(JSON.parse(lines[1] as string).id).toBe('t-2')
  })

  it('flushToFile on an empty sender writes an empty file', async () => {
    const sender = new LocalBatchSender()
    const path = join(dir, 'empty.jsonl')
    await sender.flushToFile(path)
    const body = await readFile(path, 'utf8')
    expect(body).toBe('')
  })

  it('round-trip: capture → flushToFile → replay produces the same spans', async () => {
    const { client, sender } = createTestClient()
    await client.trace('rag', async (t) => {
      await t.span('retrieve', 'retrieval', async () => {})
      await t.span('generate', 'llm', async (s) => {
        s.setModel('gpt-4o')
      })
    })
    client.flush()

    const path = join(dir, 'roundtrip.jsonl')
    await sender.flushToFile(path)

    const result = await replay({ file: path })
    expect(result.replayed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.sender.traces).toHaveLength(1)
    expect(result.sender.spans.map((s) => s.name).sort()).toEqual([
      'generate',
      'retrieve',
    ])
    expect(result.sender.spans.find((s) => s.name === 'generate')?.model).toBe(
      'gpt-4o',
    )
  })

  it('replay re-uses the provided sender', async () => {
    const source = new LocalBatchSender()
    source.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    const path = join(dir, 'dest.jsonl')
    await source.flushToFile(path)

    const dest = new LocalBatchSender()
    dest.enqueue(makeTrace('pre-existing', []))
    const result = await replay({ file: path, sender: dest })

    expect(result.sender).toBe(dest)
    expect(dest.traces.map((t) => t.id)).toEqual(['pre-existing', 't-1'])
  })

  it('replay skips malformed lines and logs a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    const path = join(dir, 'mixed.jsonl')
    const good = JSON.stringify(makeTrace('t-good', []))
    await writeFile(path, [good, '{not json', '   ', good].join('\n'), 'utf8')

    const result = await replay({ file: path })
    expect(result.replayed).toBe(2)
    expect(result.skipped).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('malformed JSON on line 2'),
    )
  })

  it('replay skips JSON payloads that are not TraceData', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    const path = join(dir, 'wrong-shape.jsonl')
    await writeFile(
      path,
      JSON.stringify({ hello: 'world' }) + '\n',
      'utf8',
    )

    const result = await replay({ file: path })
    expect(result.replayed).toBe(0)
    expect(result.skipped).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not a TraceData'),
    )
  })

  it('replay does not throw on empty files', async () => {
    const path = join(dir, 'empty.jsonl')
    await writeFile(path, '', 'utf8')
    const result = await replay({ file: path })
    expect(result.replayed).toBe(0)
    expect(result.skipped).toBe(0)
  })
})

// ---- helpers ----

function makeSpan(id: string, traceId: string, name = 'test-span'): SpanData {
  return {
    id,
    trace_id: traceId,
    name,
    span_type: 'other',
    input: null,
    output: null,
    error: false,
    error_message: null,
    latency_ms: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    metadata: {},
    started_at: new Date().toISOString(),
    ended_at: null,
  }
}

function makeTrace(id: string, spans: SpanData[]): TraceData {
  return {
    id,
    project_id: 'test',
    session_id: null,
    external_id: null,
    name: null,
    input: null,
    output: null,
    model: null,
    latency_ms: null,
    cost: null,
    error: false,
    error_message: null,
    tags: [],
    metadata: {},
    spans,
    started_at: new Date().toISOString(),
    ended_at: null,
  }
}
