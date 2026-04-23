import type { TraceContext } from '../trace.js'

/**
 * Auto-instrumentation for the Mastra agent framework (`@mastra/core`).
 *
 * Structural typing — no runtime dependency on `@mastra/core`. We accept any
 * object whose shape matches the Mastra `Agent` / `Workflow` surface.
 *
 * Emits OTel GenAI semconv attributes as span metadata:
 *   - `gen_ai.system` = "mastra"
 *   - `gen_ai.request.model` (where the underlying model exposes an id)
 *   - `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (when present)
 *
 * Never throws into user code — instrumentation errors are caught, warned to
 * the console, and the original return value is surfaced unchanged.
 */

type AgentLike = {
  name?: string
  generate?: (...args: unknown[]) => unknown
  stream?: (...args: unknown[]) => unknown
  llm?: { modelId?: string; provider?: string }
  model?: { modelId?: string; provider?: string } | string
}

type WorkflowStepLike = {
  id?: string
  name?: string
  execute?: (...args: unknown[]) => unknown
}

type WorkflowLike = {
  name?: string
  steps?: Record<string, WorkflowStepLike> | WorkflowStepLike[]
  execute?: (...args: unknown[]) => unknown
}

type GenerateParams = {
  messages?: Array<{ role?: string; content?: string | Array<{ text?: string; type?: string }> }>
  prompt?: string
  input?: string
  [key: string]: unknown
}

type GenerateResult = {
  text?: string
  content?: string
  object?: unknown
  response?: { text?: string }
  usage?: {
    promptTokens?: number
    completionTokens?: number
    inputTokens?: number
    outputTokens?: number
  }
  [key: string]: unknown
}

function extractInput(params: GenerateParams | undefined): string {
  if (!params) return ''
  if (typeof params.prompt === 'string') return params.prompt
  if (typeof params.input === 'string') return params.input
  if (Array.isArray(params.messages) && params.messages.length > 0) {
    const last = params.messages[params.messages.length - 1]
    if (typeof last?.content === 'string') return last.content
    if (Array.isArray(last?.content)) {
      const block = last.content.find((b) => b?.type === 'text')
      if (block && typeof block.text === 'string') return block.text
    }
  }
  return ''
}

function extractModel(agent: AgentLike): string | null {
  if (typeof agent.model === 'string') return agent.model
  if (agent.model && typeof agent.model === 'object' && typeof agent.model.modelId === 'string') {
    return agent.model.modelId
  }
  if (agent.llm && typeof agent.llm.modelId === 'string') return agent.llm.modelId
  return null
}

function extractOutput(result: GenerateResult | undefined): string {
  if (!result) return ''
  if (typeof result.text === 'string') return result.text
  if (typeof result.content === 'string') return result.content
  if (result.response && typeof result.response.text === 'string') return result.response.text
  if (result.object !== undefined) {
    try {
      return JSON.stringify(result.object)
    } catch {
      return ''
    }
  }
  return ''
}

function extractTokens(
  result: GenerateResult | undefined,
): { input?: number; output?: number } {
  const usage = result?.usage
  if (!usage) return {}
  const out: { input?: number; output?: number } = {}
  const input = usage.inputTokens ?? usage.promptTokens
  const output = usage.outputTokens ?? usage.completionTokens
  if (input !== undefined) out.input = input
  if (output !== undefined) out.output = output
  return out
}

function safeWarn(message: string, err: unknown): void {
  try {
    console.warn(`[trulayer] ${message}`, err)
  } catch {
    /* never throw */
  }
}

/**
 * Returns a new instrumented Mastra agent. Calls to `.generate()` and
 * `.stream()` are wrapped in a span. The original agent is not mutated.
 */
export function instrumentMastraAgent<T extends AgentLike>(agent: T, trace: TraceContext): T {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (prop === 'generate' && typeof value === 'function') {
        return function instrumentedGenerate(...args: [GenerateParams, ...unknown[]]) {
          const params = args[0]
          return (async () => {
            return trace.span(`mastra.${target.name ?? 'agent'}.generate`, 'llm', async (span) => {
              try {
                span.setInput(extractInput(params))
                const model = extractModel(target)
                if (model) span.setModel(model)
                span.setMetadata({
                  'gen_ai.system': 'mastra',
                  ...(model ? { 'gen_ai.request.model': model } : {}),
                })
              } catch (err) {
                safeWarn('mastra agent span setup failed', err)
              }

              const result = (await (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              )) as GenerateResult

              try {
                span.setOutput(extractOutput(result))
                const tokens = extractTokens(result)
                span.setTokens(tokens.input, tokens.output)
                if (tokens.input !== undefined || tokens.output !== undefined) {
                  span.setMetadata({
                    ...(tokens.input !== undefined
                      ? { 'gen_ai.usage.input_tokens': tokens.input }
                      : {}),
                    ...(tokens.output !== undefined
                      ? { 'gen_ai.usage.output_tokens': tokens.output }
                      : {}),
                  })
                }
              } catch (err) {
                safeWarn('mastra agent span teardown failed', err)
              }

              return result
            })
          })()
        }
      }

      if (prop === 'stream' && typeof value === 'function') {
        return function instrumentedStream(...args: [GenerateParams, ...unknown[]]) {
          const params = args[0]
          return (async () => {
            return trace.span(`mastra.${target.name ?? 'agent'}.stream`, 'llm', async (span) => {
              try {
                span.setInput(extractInput(params))
                const model = extractModel(target)
                if (model) span.setModel(model)
                span.setMetadata({
                  'gen_ai.system': 'mastra',
                  ...(model ? { 'gen_ai.request.model': model } : {}),
                })
              } catch (err) {
                safeWarn('mastra stream span setup failed', err)
              }

              const result = (await (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              )) as GenerateResult & {
                text?: Promise<string> | string
                usage?: Promise<GenerateResult['usage']> | GenerateResult['usage']
              }

              // Mastra's stream result exposes text/usage as either sync or
              // promise-bearing fields depending on version. Resolve both and
              // close the span with whatever is available.
              try {
                const text = await Promise.resolve(result.text)
                if (typeof text === 'string') span.setOutput(text)
                const usage = await Promise.resolve(result.usage)
                if (usage) {
                  const input = usage.inputTokens ?? usage.promptTokens
                  const output = usage.outputTokens ?? usage.completionTokens
                  span.setTokens(input, output)
                  span.setMetadata({
                    ...(input !== undefined ? { 'gen_ai.usage.input_tokens': input } : {}),
                    ...(output !== undefined ? { 'gen_ai.usage.output_tokens': output } : {}),
                  })
                }
              } catch (err) {
                safeWarn('mastra stream span teardown failed', err)
              }

              return result
            })
          })()
        }
      }

      return value
    },
  }) as T
}

/**
 * Returns a new instrumented Mastra workflow. The top-level `.execute()` call
 * is wrapped in a workflow span, and each step's `.execute()` is wrapped in a
 * nested child span via the trace's span stack.
 */
export function instrumentMastraWorkflow<T extends WorkflowLike>(
  workflow: T,
  trace: TraceContext,
): T {
  // Pre-wrap step objects so step.execute emits child spans when invoked by
  // the workflow engine. We return a new object to avoid mutation.
  const wrappedSteps: Record<string, WorkflowStepLike> | WorkflowStepLike[] | undefined =
    (() => {
      if (!workflow.steps) return undefined
      if (Array.isArray(workflow.steps)) {
        return workflow.steps.map((step) => wrapStep(step, trace))
      }
      const out: Record<string, WorkflowStepLike> = {}
      for (const [key, step] of Object.entries(workflow.steps)) {
        out[key] = wrapStep(step, trace)
      }
      return out
    })()

  return new Proxy(workflow, {
    get(target, prop, receiver) {
      if (prop === 'steps' && wrappedSteps !== undefined) {
        return wrappedSteps
      }

      const value = Reflect.get(target, prop, receiver)
      if (prop === 'execute' && typeof value === 'function') {
        return function instrumentedExecute(...args: unknown[]) {
          return (async () => {
            return trace.span(
              `mastra.workflow.${target.name ?? 'workflow'}`,
              'chain',
              async (span) => {
                try {
                  span.setInput(
                    typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] ?? {}),
                  )
                  span.setMetadata({ 'gen_ai.system': 'mastra' })
                } catch (err) {
                  safeWarn('mastra workflow span setup failed', err)
                }
                const result = await (value as (...a: unknown[]) => unknown).apply(target, args)
                try {
                  span.setOutput(typeof result === 'string' ? result : JSON.stringify(result ?? ''))
                } catch (err) {
                  safeWarn('mastra workflow span teardown failed', err)
                }
                return result
              },
            )
          })()
        }
      }
      return value
    },
  }) as T
}

function wrapStep(step: WorkflowStepLike, trace: TraceContext): WorkflowStepLike {
  return new Proxy(step, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'execute' && typeof value === 'function') {
        return function instrumentedStepExecute(...args: unknown[]) {
          return (async () => {
            return trace.span(
              `mastra.step.${target.id ?? target.name ?? 'step'}`,
              'default',
              async (span) => {
                try {
                  span.setInput(
                    typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] ?? {}),
                  )
                  span.setMetadata({ 'gen_ai.system': 'mastra' })
                } catch (err) {
                  safeWarn('mastra step span setup failed', err)
                }
                const result = await (value as (...a: unknown[]) => unknown).apply(target, args)
                try {
                  span.setOutput(typeof result === 'string' ? result : JSON.stringify(result ?? ''))
                } catch (err) {
                  safeWarn('mastra step span teardown failed', err)
                }
                return result
              },
            )
          })()
        }
      }
      return value
    },
  })
}
