/**
 * Truncation helpers for `get_trace`.
 *
 * LLM span I/O can be arbitrarily large (entire prompts, completions,
 * multi-turn history). A single trace can blow an agent's context
 * window. We truncate per-field and surface a top-level `_truncated`
 * flag so the agent knows to request narrower data.
 */

export const DEFAULT_TRUNCATE_BYTES = 2000

const TRUNC_SUFFIX = '...[truncated]'

/**
 * Truncate a string by UTF-8 byte length, preserving valid UTF-8
 * boundaries. Shorter inputs are returned unchanged.
 */
export function truncateString(s: string, maxBytes: number): { value: string; truncated: boolean } {
  if (s.length <= maxBytes) return { value: s, truncated: false }
  const encoder = new TextEncoder()
  const bytes = encoder.encode(s)
  if (bytes.byteLength <= maxBytes) return { value: s, truncated: false }
  // Decode back up to maxBytes, then drop any incomplete trailing UTF-8 sequence
  // by letting TextDecoder replace it.
  const slice = bytes.subarray(0, maxBytes)
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/�+$/, '')
  return { value: decoded + TRUNC_SUFFIX, truncated: true }
}

/**
 * Span I/O fields to truncate. These are the common high-volume fields
 * produced by LLM spans across OpenAI / Anthropic / Vercel AI instrumentation.
 */
const SPAN_IO_KEYS = new Set([
  'input',
  'output',
  'prompt',
  'completion',
  'response',
  'request',
  'messages',
  'content',
  'body',
])

interface TruncationState {
  truncated: boolean
}

function truncateField(value: unknown, maxBytes: number, state: TruncationState): unknown {
  if (typeof value === 'string') {
    const r = truncateString(value, maxBytes)
    if (r.truncated) state.truncated = true
    return r.value
  }
  if (value === null || typeof value !== 'object') return value
  // Stringify non-string structured fields (message arrays, JSON objects)
  // and truncate the serialized form. This keeps the byte budget honest
  // without recursing indefinitely into nested user payloads.
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= maxBytes) return value
    const r = truncateString(serialized, maxBytes)
    if (r.truncated) state.truncated = true
    return r.value
  } catch {
    return value
  }
}

/**
 * Walk a trace response and truncate each span's I/O fields to
 * `maxBytes`. Mutates a deep copy and returns the copy plus an overall
 * `truncated` flag.
 */
export function truncateTrace(
  trace: unknown,
  maxBytes: number = DEFAULT_TRUNCATE_BYTES,
): { trace: unknown; truncated: boolean } {
  if (trace === null || typeof trace !== 'object') {
    return { trace, truncated: false }
  }
  const state: TruncationState = { truncated: false }
  const cloned = deepClone(trace)
  walkAndTruncate(cloned, maxBytes, state)
  return { trace: cloned, truncated: state.truncated }
}

function walkAndTruncate(node: unknown, maxBytes: number, state: TruncationState): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkAndTruncate(item, maxBytes, state)
    return
  }
  const obj = node as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (SPAN_IO_KEYS.has(key)) {
      obj[key] = truncateField(val, maxBytes, state)
      continue
    }
    if (val !== null && typeof val === 'object') {
      walkAndTruncate(val, maxBytes, state)
    }
  }
}

function deepClone<T>(value: T): T {
  // structuredClone is available in Node 18+.
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}
