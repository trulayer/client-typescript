import { describe, expect, it, vi } from 'vitest'

import { HttpClient } from '../src/http.js'
import { ALL_TOOLS, toolByName } from '../src/tools.js'

function mockClient(responder: (path: string, query: Record<string, unknown>) => unknown) {
  const client = {
    get: vi.fn(async (opts: { path: string; query?: Record<string, unknown> }) =>
      responder(opts.path, opts.query ?? {}),
    ),
  } as unknown as HttpClient
  return client
}

describe('tool surface', () => {
  it('exposes exactly the 8 v1 tools', () => {
    const names = ALL_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'get_eval',
        'get_eval_trends',
        'get_metrics',
        'get_trace',
        'list_anomalies',
        'list_eval_rules',
        'list_evals',
        'list_traces',
      ].sort(),
    )
  })

  it('each tool has a description and a JSON Schema object', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema).toMatchObject({ type: 'object' })
    }
  })
})

describe('list_traces', () => {
  it('maps filter arguments to GET /v1/traces query params', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/traces')
      expect(query).toMatchObject({
        project_id: 'p1',
        model: 'gpt-4o',
        error: true,
        failure_type: 'timeout',
        cursor: 'abc',
        limit: 50,
      })
      return { traces: [], has_more: false }
    })
    const tool = toolByName('list_traces')!
    await tool.handler(
      {
        project_id: 'p1',
        model: 'gpt-4o',
        error: true,
        failure_type: 'timeout',
        cursor: 'abc',
        limit: 50,
      },
      client,
    )
  })
})

describe('get_trace', () => {
  it('requires id and truncates large span I/O', async () => {
    const client = mockClient(() => ({
      id: 't1',
      spans: [{ id: 's1', input: 'x'.repeat(10_000) }],
    }))
    const tool = toolByName('get_trace')!
    const out = (await tool.handler({ id: 't1' }, client)) as {
      _truncated: boolean
      spans: Array<{ input: string }>
    }
    expect(out._truncated).toBe(true)
    expect(out.spans[0]!.input.endsWith('[truncated]')).toBe(true)
  })

  it('does not set _truncated when content fits', async () => {
    const client = mockClient(() => ({ id: 't1', spans: [{ id: 's1', input: 'small' }] }))
    const tool = toolByName('get_trace')!
    const out = (await tool.handler({ id: 't1' }, client)) as Record<string, unknown>
    expect(out._truncated).toBeUndefined()
  })

  it('rejects missing id', async () => {
    const client = mockClient(() => ({}))
    const tool = toolByName('get_trace')!
    await expect(tool.handler({}, client)).rejects.toThrow(/id/)
  })

  it('URL-encodes the id into the path', async () => {
    const client = mockClient((path) => {
      expect(path).toBe('/v1/traces/weird%2Fid')
      return {}
    })
    const tool = toolByName('get_trace')!
    await tool.handler({ id: 'weird/id' }, client)
  })
})

describe('list_evals', () => {
  it('passes pagination and time-range args', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/eval')
      expect(query).toMatchObject({ project_id: 'p', cursor: 'c', limit: 10 })
      return {}
    })
    await toolByName('list_evals')!.handler(
      { project_id: 'p', cursor: 'c', limit: 10 },
      client,
    )
  })
})

describe('get_eval', () => {
  it('requires id', async () => {
    await expect(
      toolByName('get_eval')!.handler({}, mockClient(() => ({}))),
    ).rejects.toThrow(/id/)
  })

  it('hits /v1/eval/{id}', async () => {
    const client = mockClient((path) => {
      expect(path).toBe('/v1/eval/e1')
      return { id: 'e1' }
    })
    const out = await toolByName('get_eval')!.handler({ id: 'e1' }, client)
    expect(out).toEqual({ id: 'e1' })
  })
})

describe('get_eval_trends', () => {
  it('requires project_id', async () => {
    await expect(
      toolByName('get_eval_trends')!.handler({}, mockClient(() => ({}))),
    ).rejects.toThrow(/project_id/)
  })

  it('forwards project_id and time range', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/eval/trends')
      expect(query).toMatchObject({ project_id: 'p', from: 'a', to: 'b' })
      return {}
    })
    await toolByName('get_eval_trends')!.handler(
      { project_id: 'p', from: 'a', to: 'b' },
      client,
    )
  })
})

describe('list_eval_rules', () => {
  it('hits /v1/eval-rules with pagination', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/eval-rules')
      expect(query).toMatchObject({ project_id: 'p', limit: 5 })
      return {}
    })
    await toolByName('list_eval_rules')!.handler({ project_id: 'p', limit: 5 }, client)
  })
})

describe('get_metrics', () => {
  it('defaults from/to to the last 24h when omitted', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/metrics')
      expect(typeof query.from).toBe('string')
      expect(typeof query.to).toBe('string')
      const from = new Date(query.from as string).getTime()
      const to = new Date(query.to as string).getTime()
      expect(to - from).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000)
      expect(to - from).toBeLessThanOrEqual(25 * 60 * 60 * 1000)
      return {}
    })
    await toolByName('get_metrics')!.handler({}, client)
  })

  it('uses provided from/to when present', async () => {
    const client = mockClient((_path, query) => {
      expect(query.from).toBe('2024-01-01T00:00:00Z')
      expect(query.to).toBe('2024-01-02T00:00:00Z')
      return {}
    })
    await toolByName('get_metrics')!.handler(
      { from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z' },
      client,
    )
  })
})

describe('list_anomalies', () => {
  it('hits /v1/anomalies and forwards filters', async () => {
    const client = mockClient((path, query) => {
      expect(path).toBe('/v1/anomalies')
      expect(query).toMatchObject({ project_id: 'p', cursor: 'next' })
      return {}
    })
    await toolByName('list_anomalies')!.handler(
      { project_id: 'p', cursor: 'next' },
      client,
    )
  })
})
