export type SpanType = 'llm' | 'tool' | 'retrieval' | 'chain' | 'default'

export interface SpanData {
  id: string
  trace_id: string
  name: string
  span_type: SpanType
  input: string | null
  output: string | null
  error: boolean
  error_message: string | null
  latency_ms: number | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  metadata: Record<string, unknown>
  started_at: string // ISO 8601
  ended_at: string | null
}

export interface TraceData {
  id: string
  project_id: string
  session_id: string | null
  external_id: string | null
  name: string | null
  input: string | null
  output: string | null
  model: string | null
  latency_ms: number | null
  cost: number | null
  error: boolean
  tags: string[]
  metadata: Record<string, unknown>
  spans: SpanData[]
  started_at: string // ISO 8601
  ended_at: string | null
}

export interface FeedbackData {
  trace_id: string
  label: string // good | bad | neutral
  score?: number
  comment?: string
  metadata?: Record<string, unknown>
}

export interface TruLayerConfig {
  apiKey: string
  /** Human-readable project name. Backend resolves it to a project_id from
   *  the API key's tenant. Use this. */
  projectName?: string
  /** @deprecated Use {@link TruLayerConfig.projectName}. Removed in 0.3.x. */
  projectId?: string
  endpoint?: string
  batchSize?: number
  flushInterval?: number // ms
}
