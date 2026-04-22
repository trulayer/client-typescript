import { describe, expect, it } from 'vitest'

import { truncateString, truncateTrace } from '../src/truncate.js'

describe('truncateString', () => {
  it('returns short strings unchanged', () => {
    const r = truncateString('hello', 2000)
    expect(r).toEqual({ value: 'hello', truncated: false })
  })

  it('truncates strings longer than the byte limit and appends a marker', () => {
    const big = 'x'.repeat(5000)
    const r = truncateString(big, 2000)
    expect(r.truncated).toBe(true)
    expect(r.value.length).toBeLessThanOrEqual(2000 + '...[truncated]'.length)
    expect(r.value).toMatch(/\[truncated\]$/)
  })
})

describe('truncateTrace', () => {
  it('truncates span input and output fields and flags the overall result', () => {
    const trace = {
      id: 't1',
      spans: [
        { id: 's1', input: 'x'.repeat(4000), output: 'short' },
        { id: 's2', input: 'fine', output: 'y'.repeat(5000) },
      ],
    }
    const { trace: out, truncated } = truncateTrace(trace, 100)
    expect(truncated).toBe(true)
    const obj = out as { spans: Array<{ input: string; output: string }> }
    expect(obj.spans[0]!.input.endsWith('[truncated]')).toBe(true)
    expect(obj.spans[0]!.output).toBe('short')
    expect(obj.spans[1]!.input).toBe('fine')
    expect(obj.spans[1]!.output.endsWith('[truncated]')).toBe(true)
  })

  it('reports truncated=false when nothing exceeds the limit', () => {
    const trace = { id: 't1', spans: [{ id: 's1', input: 'a', output: 'b' }] }
    const { truncated } = truncateTrace(trace, 1000)
    expect(truncated).toBe(false)
  })

  it('does not mutate the input', () => {
    const trace = { id: 't1', spans: [{ id: 's1', input: 'x'.repeat(100) }] }
    const original = JSON.stringify(trace)
    truncateTrace(trace, 10)
    expect(JSON.stringify(trace)).toBe(original)
  })

  it('truncates structured message arrays by serialized length', () => {
    const trace = {
      spans: [
        {
          messages: Array.from({ length: 50 }, (_, i) => ({
            role: 'user',
            content: `message ${i} ${'z'.repeat(200)}`,
          })),
        },
      ],
    }
    const { truncated } = truncateTrace(trace, 200)
    expect(truncated).toBe(true)
  })
})
