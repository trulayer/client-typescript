import { describe, it, expect } from 'vitest'
import type { TraceData, SpanData, FeedbackData } from '../../src/model.js'

describe('model types', () => {
  it('TraceData shape is correct', () => {
    const t: TraceData = {
      id: 'abc',
      project_id: 'proj-1',
      session_id: null,
      name: 'test',
      input: 'hi',
      output: 'hello',
      error: null,
      tags: [],
      metadata: {},
      spans: [],
      started_at: new Date().toISOString(),
      ended_at: null,
    }
    expect(t.project_id).toBe('proj-1')
    expect(t.error).toBeNull()
  })

  it('SpanData shape is correct', () => {
    const s: SpanData = {
      id: 'span-1',
      trace_id: 'trace-1',
      name: 'llm-call',
      span_type: 'llm',
      input: 'prompt',
      output: 'response',
      error: null,
      latency_ms: 120,
      model: 'gpt-4o',
      prompt_tokens: 10,
      completion_tokens: 5,
      metadata: {},
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    }
    expect(s.span_type).toBe('llm')
  })

  it('FeedbackData shape is correct', () => {
    const fb: FeedbackData = { trace_id: 'abc', label: 'good', score: 1.0 }
    expect(fb.label).toBe('good')
  })
})
