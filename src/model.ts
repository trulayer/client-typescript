/** @internal Minimal batch sender contract shared by server and browser senders. */
export interface BatchSenderLike {
  enqueue(trace: TraceData): void
  flush(): void
  shutdown(): Promise<void>
}

export type SpanType = 'llm' | 'tool' | 'retrieval' | 'chain' | 'default'

export interface SpanData {
  id: string
  trace_id: string
  parent_span_id?: string | undefined
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
  /** Fraction of traces to send (0.0–1.0). Default: 1.0 (send all).
   *  When a trace is sampled out, the user callback still executes but no
   *  data is sent to TruLayer. */
  sampleRate?: number
  /** Called on every span/trace input and output before enqueuing.
   *  Return value replaces the original. Throw to drop the field entirely
   *  (stores null and emits a console.warn). */
  redact?: (data: unknown) => unknown
  /** URL of a server-side relay that forwards batches to the TruLayer API.
   *  Required when using `initBrowser()` from `@trulayer/sdk/browser`.
   *  Example: `'/api/trulayer'`. The relay is responsible for attaching
   *  the `Authorization` header before proxying to TruLayer. */
  relayUrl?: string
}
