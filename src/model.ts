/** @internal Minimal batch sender contract shared by server and browser senders. */
export interface BatchSenderLike {
  enqueue(trace: TraceData): void
  flush(): void
  shutdown(): Promise<void>
}

export type SpanType = 'llm' | 'tool' | 'retrieval' | 'other'

/**
 * In-memory span representation used by the SDK. Field names are ergonomic
 * (`span_type`, `started_at`, `ended_at`) and match the SDK surface; they are
 * translated to the TruLayer ingestion wire format by {@link spanToWire}.
 */
export interface SpanData {
  id: string
  trace_id: string
  parent_span_id?: string | undefined
  name: string
  span_type: SpanType
  input: string | null
  output: string | null
  error: string | null
  latency_ms: number | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  metadata: Record<string, unknown>
  started_at: string // ISO 8601
  ended_at: string | null
}

/**
 * In-memory trace representation used by the SDK. Translated to the wire
 * format by {@link traceToWire}.
 */
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
  error: string | null
  tags: string[]
  /**
   * Optional structured key → value tags. When non-empty, this is sent
   * as the `tags` field on the ingestion wire format (object form) and
   * takes precedence over the legacy string-array `tags` field. Enables
   * server-side filtering by tag key/value pair on list endpoints.
   *
   * Limits: max 20 keys, max 64 characters per key and value.
   */
  tag_map?: Record<string, string>
  metadata: Record<string, unknown>
  spans: SpanData[]
  started_at: string // ISO 8601
  ended_at: string | null
}

/**
 * Span wire shape sent to the TruLayer ingestion API.
 * - `span_type`  → `type`
 * - `started_at` → `start_time`
 * - `ended_at`   → `end_time`
 */
export interface SpanWire {
  id: string
  trace_id: string
  parent_span_id?: string
  name: string
  type: SpanType
  input: string | null
  output: string | null
  error: string | null
  latency_ms: number | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  metadata: Record<string, unknown>
  start_time: string
  end_time: string | null
}

/** Trace wire shape sent to the TruLayer ingestion API. */
export interface TraceWire {
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
  error: string | null
  /**
   * Wire field — either a string array (legacy) or a `{key: value}` map
   * (TRU-215). Map form takes precedence when both are set on the
   * in-memory `TraceData`.
   */
  tags: string[] | Record<string, string>
  metadata: Record<string, unknown>
  spans: SpanWire[]
  started_at: string
  ended_at: string | null
}

export function spanToWire(s: SpanData): SpanWire {
  const wire: SpanWire = {
    id: s.id,
    trace_id: s.trace_id,
    name: s.name,
    type: s.span_type,
    input: s.input,
    output: s.output,
    error: s.error,
    latency_ms: s.latency_ms,
    model: s.model,
    prompt_tokens: s.prompt_tokens,
    completion_tokens: s.completion_tokens,
    metadata: s.metadata,
    start_time: s.started_at,
    end_time: s.ended_at,
  }
  if (s.parent_span_id !== undefined) {
    wire.parent_span_id = s.parent_span_id
  }
  return wire
}

export function traceToWire(t: TraceData): TraceWire {
  // When a non-empty tag_map is set it takes precedence over the legacy
  // string-array `tags` — the server indexes map-form tags and exposes
  // them to the dashboard filter bar.
  const hasTagMap =
    t.tag_map !== undefined && Object.keys(t.tag_map).length > 0
  return {
    id: t.id,
    project_id: t.project_id,
    session_id: t.session_id,
    external_id: t.external_id,
    name: t.name,
    input: t.input,
    output: t.output,
    model: t.model,
    latency_ms: t.latency_ms,
    cost: t.cost,
    error: t.error,
    tags: hasTagMap ? (t.tag_map as Record<string, string>) : t.tags,
    metadata: t.metadata,
    spans: t.spans.map(spanToWire),
    started_at: t.started_at,
    ended_at: t.ended_at,
  }
}

export interface FeedbackData {
  trace_id: string
  label: string // good | bad | neutral
  score?: number
  comment?: string
  metadata?: Record<string, unknown>
}

/** Request body for POST /v1/eval. */
export interface EvalRequest {
  trace_id: string
  evaluator_type: string
  metric_name: string
}

/** Response body from POST /v1/eval. */
export interface EvalTriggerResponse {
  eval_id: string
  status: string
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
