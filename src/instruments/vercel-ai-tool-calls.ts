import type { TraceContext } from '../trace.js'

/**
 * Vercel AI SDK tool-call instrumentation.
 *
 * The base `instrumentVercelAI` helper wraps top-level `generateText` /
 * `streamText` / `generateObject` calls but does not capture individual tool
 * invocations. This helper wraps a `tools` record (as passed to the AI SDK)
 * and emits a child span for each tool call, without otherwise altering the
 * tool's behaviour.
 *
 * Span attributes (OTel GenAI semconv):
 *   - `gen_ai.tool.name`
 *   - `gen_ai.tool.call.id` (when the caller forwards a tool_call_id via
 *     `options`)
 *   - input / output recorded on the span itself (subject to the trace's
 *     redaction callback)
 *
 * Never throws into user code — instrumentation errors are caught and the
 * original tool result or rejection is surfaced unchanged.
 */

// The AI SDK calls a tool's `execute` with `(input, options)` where `options`
// may carry `toolCallId`, `messages`, `abortSignal`, etc. We accept unknown
// extra options structurally.

type ToolExecuteOptions = {
  toolCallId?: string
  [key: string]: unknown
}

type ToolLike = {
  description?: string
  // AI SDK v4+: `inputSchema`. Older versions: `parameters`. We don't touch either.
  execute?: (input: unknown, options?: ToolExecuteOptions) => unknown
  [key: string]: unknown
}

type ToolsRecord = Record<string, ToolLike>

function safeWarn(message: string, err: unknown): void {
  try {
    console.warn(`[trulayer] ${message}`, err)
  } catch {
    /* never throw */
  }
}

function serialise(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Returns a new tools record where each tool's `execute` is wrapped in a
 * `tool` span. Input/output respect the trace's redact callback because they
 * flow through `span.setInput` / `span.setOutput`.
 */
export function instrumentVercelAITools<T extends ToolsRecord>(tools: T, trace: TraceContext): T {
  const wrapped: ToolsRecord = {}
  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = wrapTool(name, tool, trace)
  }
  return wrapped as T
}

function wrapTool(name: string, tool: ToolLike, trace: TraceContext): ToolLike {
  if (typeof tool.execute !== 'function') return tool

  const originalExecute = tool.execute
  const instrumentedExecute = function instrumentedExecute(
    input: unknown,
    options?: ToolExecuteOptions,
  ) {
    return (async () => {
      return trace.span(`vercel-ai.tool.${name}`, 'tool', async (span) => {
        try {
          span.setInput(serialise(input))
          span.setMetadata({
            'gen_ai.system': 'vercel-ai',
            'gen_ai.tool.name': name,
            ...(options?.toolCallId
              ? { 'gen_ai.tool.call.id': options.toolCallId }
              : {}),
          })
        } catch (err) {
          safeWarn(`vercel-ai tool ${name} span setup failed`, err)
        }

        try {
          const result = await originalExecute(input, options)
          try {
            span.setOutput(serialise(result))
          } catch (err) {
            safeWarn(`vercel-ai tool ${name} span teardown failed`, err)
          }
          return result
        } catch (err) {
          // Let the span-callback machinery mark the span as errored by rethrowing.
          throw err
        }
      })
    })()
  }

  // Return a new tool object; do not mutate the caller's tool.
  return { ...tool, execute: instrumentedExecute }
}
