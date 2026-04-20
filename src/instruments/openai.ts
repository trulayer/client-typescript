import type { TraceContext } from '../trace.js'

type OpenAIClient = {
  chat: {
    completions: {
      create: (...args: unknown[]) => unknown
    }
  }
}

type ChatCompletionParams = {
  model?: string
  messages?: Array<{ content?: string; role?: string }>
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Returns a new instrumented OpenAI client that records spans into `trace`.
 * Never mutates the original client.
 */
export function instrumentOpenAI<T extends OpenAIClient>(client: T, trace: TraceContext): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'chat') return Reflect.get(target, prop, receiver)

      return new Proxy(target.chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== 'completions') return Reflect.get(chatTarget, chatProp, chatReceiver)

          return new Proxy(chatTarget.completions, {
            get(compTarget, compProp, compReceiver) {
              if (compProp !== 'create') return Reflect.get(compTarget, compProp, compReceiver)

              return async function (...args: [ChatCompletionParams, ...unknown[]]) {
                const params = args[0] ?? {}
                const messages = params.messages ?? []
                const lastMsg = messages[messages.length - 1]
                const inputText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

                return trace.span('openai.chat', 'llm', async (span) => {
                  span.setInput(inputText)
                  if (params.model) span.setModel(params.model)

                  const result = (await (compTarget.create as (...args: unknown[]) => unknown)(
                    ...args,
                  )) as ChatCompletionResponse

                  const output = result.choices?.[0]?.message?.content ?? ''
                  span.setOutput(output)
                  if (result.usage) {
                    span.setTokens(result.usage.prompt_tokens, result.usage.completion_tokens)
                  }
                  return result
                })
              }
            },
          })
        },
      })
    },
  }) as T
}
