import type { TraceContext } from '../trace.js'

// Loose types so we don't take a hard dependency on the `ai` package.
// These match the Vercel AI SDK v3/v4 signatures.

type ModelLike = { modelId?: string; provider?: string }

type MessageLike = {
  role?: string
  content?: string | Array<{ type?: string; text?: string }>
}

type GenerateParams = {
  model?: ModelLike
  prompt?: string
  messages?: MessageLike[]
  [key: string]: unknown
}

type GenerateTextResult = {
  text?: string
  usage?: { promptTokens?: number; completionTokens?: number }
  [key: string]: unknown
}

type GenerateObjectResult = {
  object?: unknown
  usage?: { promptTokens?: number; completionTokens?: number }
  [key: string]: unknown
}

type StreamTextResult = {
  text?: Promise<string>
  usage?: Promise<{ promptTokens?: number; completionTokens?: number }>
  [key: string]: unknown
}

type AIFunction<P, R> = (params: P) => R

function extractInput(params: GenerateParams): string {
  if (params.prompt) return params.prompt
  if (params.messages?.length) {
    const last = params.messages[params.messages.length - 1]
    if (typeof last?.content === 'string') return last.content
    if (Array.isArray(last?.content)) {
      const block = (last.content as Array<{ type?: string; text?: string }>).find(
        (b) => b.type === 'text',
      )
      return block?.text ?? ''
    }
  }
  return ''
}

function extractModel(params: GenerateParams): string | null {
  return params.model?.modelId ?? null
}

/**
 * Returns instrumented wrappers for Vercel AI SDK's generateText, streamText,
 * and generateObject. Attach to an active trace to capture spans automatically.
 *
 * Usage:
 *   const { generateText } = instrumentVercelAI(
 *     { generateText: aiGenerateText, streamText: aiStreamText },
 *     trace,
 *   )
 */
export function instrumentVercelAI<
  G extends AIFunction<GenerateParams, Promise<GenerateTextResult>>,
  S extends AIFunction<GenerateParams, StreamTextResult>,
  O extends AIFunction<GenerateParams, Promise<GenerateObjectResult>>,
>(
  fns: { generateText?: G; streamText?: S; generateObject?: O },
  trace: TraceContext,
): { generateText: G; streamText: S; generateObject: O } {
  const wrappedGenerateText = fns.generateText
    ? (async (params: GenerateParams) => {
        return trace.span('vercel-ai.generateText', 'llm', async (span) => {
          span.setInput(extractInput(params))
          const model = extractModel(params)
          if (model) span.setModel(model)

          const result = await fns.generateText!(params)

          if (result.text) span.setOutput(result.text)
          if (result.usage) {
            span.setTokens(result.usage.promptTokens, result.usage.completionTokens)
          }
          return result
        })
      }) as G
    : (undefined as unknown as G)

  const wrappedStreamText = fns.streamText
    ? ((params: GenerateParams) => {
        // StreamText is sync and returns a result with async properties.
        // We wrap it so that we record a span that resolves when the stream ends.
        const model = extractModel(params)
        const input = extractInput(params)

        // Start span manually — we can't use the callback form here because
        // streamText returns synchronously.
        const result = fns.streamText!(params) as StreamTextResult

        void (async () => {
          try {
            const spanPromise = trace.span('vercel-ai.streamText', 'llm', async (span) => {
              span.setInput(input)
              if (model) span.setModel(model)
              try {
                const text = await result.text
                if (text) span.setOutput(text)
                const usage = await result.usage
                if (usage) span.setTokens(usage.promptTokens, usage.completionTokens)
              } catch {
                // stream error captured by span callback
                throw new Error('stream failed')
              }
            })
            await spanPromise
          } catch {
            // Never throw from SDK internals
          }
        })()

        return result
      }) as S
    : (undefined as unknown as S)

  const wrappedGenerateObject = fns.generateObject
    ? (async (params: GenerateParams) => {
        return trace.span('vercel-ai.generateObject', 'llm', async (span) => {
          span.setInput(extractInput(params))
          const model = extractModel(params)
          if (model) span.setModel(model)

          const result = await fns.generateObject!(params)

          if (result.object !== undefined) {
            span.setOutput(JSON.stringify(result.object))
          }
          if (result.usage) {
            span.setTokens(result.usage.promptTokens, result.usage.completionTokens)
          }
          return result
        })
      }) as O
    : (undefined as unknown as O)

  return {
    generateText: wrappedGenerateText,
    streamText: wrappedStreamText,
    generateObject: wrappedGenerateObject,
  }
}
