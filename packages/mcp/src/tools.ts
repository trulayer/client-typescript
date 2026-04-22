import type { HttpClient } from './http.js'
import { DEFAULT_TRUNCATE_BYTES, truncateTrace } from './truncate.js'

/**
 * Tool definition shape shared by the MCP server registration layer.
 * Each tool exposes a JSON Schema for its input and a handler that
 * executes the tool against the TruLayer API.
 */
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, client: HttpClient) => Promise<unknown>
}

// --- JSON Schema fragments shared across tools ---

const paginationProps = {
  cursor: {
    type: 'string',
    description: 'Opaque pagination cursor. Pass the next_cursor value from a previous response.',
  },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 200,
    description: 'Maximum number of results per page. Defaults to server default when omitted.',
  },
} as const

const timeRangeProps = {
  from: {
    type: 'string',
    description: 'Start of time window. RFC3339 timestamp (e.g. 2024-01-15T00:00:00Z).',
  },
  to: {
    type: 'string',
    description: 'End of time window. RFC3339 timestamp.',
  },
} as const

const projectIdProp = {
  project_id: {
    type: 'string',
    description:
      'Project identifier. Ask the human for this value if not provided — there is no agent-side discovery path in v1.',
  },
} as const

// --- String coercion helpers ---

function strOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  return String(v)
}

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function boolOrUndef(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`)
  }
  return v
}

// --- Tool definitions ---

const listTraces: ToolDef = {
  name: 'list_traces',
  description:
    'List traces with cursor-based pagination. Filter by project, model, error flag, failure type, and time range. When has_more is true, pass the returned next_cursor to get the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      model: {
        type: 'string',
        description: 'Filter by model name (e.g. gpt-4o, claude-sonnet-4-5).',
      },
      error: {
        type: 'boolean',
        description: 'If true, return only traces containing errored spans.',
      },
      failure_type: {
        type: 'string',
        enum: ['timeout', 'rate_limit', 'invalid_response', 'context_length'],
        description: 'Filter traces whose spans exhibit this failure type.',
      },
      ...timeRangeProps,
      ...paginationProps,
    },
    additionalProperties: false,
  },
  async handler(args, client) {
    return client.get({
      path: '/v1/traces',
      query: {
        project_id: strOrUndef(args.project_id),
        model: strOrUndef(args.model),
        error: boolOrUndef(args.error),
        failure_type: strOrUndef(args.failure_type),
        from: strOrUndef(args.from),
        to: strOrUndef(args.to),
        cursor: strOrUndef(args.cursor),
        limit: numOrUndef(args.limit),
      },
    })
  },
}

const getTrace: ToolDef = {
  name: 'get_trace',
  description:
    'Get a single trace with its spans. Span input/output fields are truncated to 2KB each to protect the agent context window. If any field was truncated, _truncated is true at the top level.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Trace identifier.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  async handler(args, client) {
    const id = requireString(args, 'id')
    const raw = await client.get({ path: `/v1/traces/${encodeURIComponent(id)}` })
    const { trace, truncated } = truncateTrace(raw, DEFAULT_TRUNCATE_BYTES)
    if (truncated && trace && typeof trace === 'object' && !Array.isArray(trace)) {
      ;(trace as Record<string, unknown>)._truncated = true
    }
    return trace
  },
}

const listEvals: ToolDef = {
  name: 'list_evals',
  description:
    'List eval results with cursor-based pagination. When has_more is true, pass the returned next_cursor to get the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      ...timeRangeProps,
      ...paginationProps,
    },
    additionalProperties: false,
  },
  async handler(args, client) {
    return client.get({
      path: '/v1/eval',
      query: {
        project_id: strOrUndef(args.project_id),
        from: strOrUndef(args.from),
        to: strOrUndef(args.to),
        cursor: strOrUndef(args.cursor),
        limit: numOrUndef(args.limit),
      },
    })
  },
}

const getEval: ToolDef = {
  name: 'get_eval',
  description: 'Get a single eval result by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Eval result identifier.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  async handler(args, client) {
    const id = requireString(args, 'id')
    return client.get({ path: `/v1/eval/${encodeURIComponent(id)}` })
  },
}

const getEvalTrends: ToolDef = {
  name: 'get_eval_trends',
  description:
    'Get eval metric trends over time for a project. project_id is required — ask the human if unknown.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      ...timeRangeProps,
    },
    required: ['project_id'],
    additionalProperties: false,
  },
  async handler(args, client) {
    const projectId = requireString(args, 'project_id')
    return client.get({
      path: '/v1/eval/trends',
      query: {
        project_id: projectId,
        from: strOrUndef(args.from),
        to: strOrUndef(args.to),
      },
    })
  },
}

const listEvalRules: ToolDef = {
  name: 'list_eval_rules',
  description:
    'List configured eval rules (LLM-as-judge rules that run automatically on matching traces). Distinct from failure rules, which trigger alerts. When has_more is true, pass the returned next_cursor to get the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      ...paginationProps,
    },
    additionalProperties: false,
  },
  async handler(args, client) {
    return client.get({
      path: '/v1/eval-rules',
      query: {
        project_id: strOrUndef(args.project_id),
        cursor: strOrUndef(args.cursor),
        limit: numOrUndef(args.limit),
      },
    })
  },
}

const getMetrics: ToolDef = {
  name: 'get_metrics',
  description:
    'Get aggregate metrics (latency, error rate, span counts). When from/to are omitted the API defaults to the last 24 hours.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      ...timeRangeProps,
    },
    additionalProperties: false,
  },
  async handler(args, client) {
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    return client.get({
      path: '/v1/metrics',
      query: {
        project_id: strOrUndef(args.project_id),
        from: strOrUndef(args.from) ?? dayAgo.toISOString(),
        to: strOrUndef(args.to) ?? now.toISOString(),
      },
    })
  },
}

const listAnomalies: ToolDef = {
  name: 'list_anomalies',
  description:
    'List detected anomalies (pre-clustered failure signals). Best first call for "what is broken right now?". When has_more is true, pass the returned next_cursor to get the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      ...projectIdProp,
      ...timeRangeProps,
      ...paginationProps,
    },
    additionalProperties: false,
  },
  async handler(args, client) {
    return client.get({
      path: '/v1/anomalies',
      query: {
        project_id: strOrUndef(args.project_id),
        from: strOrUndef(args.from),
        to: strOrUndef(args.to),
        cursor: strOrUndef(args.cursor),
        limit: numOrUndef(args.limit),
      },
    })
  },
}

export const ALL_TOOLS: ToolDef[] = [
  listTraces,
  getTrace,
  listEvals,
  getEval,
  getEvalTrends,
  listEvalRules,
  getMetrics,
  listAnomalies,
]

export function toolByName(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name)
}
