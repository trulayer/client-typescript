import type { TraceContext } from '../trace.js'

type AnthropicClient = {
  messages: {
    create: (...args: unknown[]) => unknown
  }
}

type MessageParams = {
  model?: string
  messages?: Array<{ content?: string; role?: string }>
}

type MessageResponse = {
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Returns a new instrumented Anthropic client that records spans into `trace`.
 * Never mutates the original client.
 */
export function instrumentAnthropic<T extends AnthropicClient>(client: T, trace: TraceContext): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'messages') return Reflect.get(target, prop, receiver)

      return new Proxy(target.messages, {
        get(msgTarget, msgProp, msgReceiver) {
          if (msgProp !== 'create') return Reflect.get(msgTarget, msgProp, msgReceiver)

          return async function (...args: [MessageParams, ...unknown[]]) {
            const params = args[0] ?? {}
            const messages = params.messages ?? []
            const lastMsg = messages[messages.length - 1]
            const inputText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

            return trace.span('anthropic.messages', 'llm', async (span) => {
              span.setInput(inputText)
              if (params.model) span.setModel(params.model)

              const result = (await (msgTarget.create as (...args: unknown[]) => unknown)(
                ...args,
              )) as MessageResponse

              const textBlock = result.content?.find((b) => b.type === 'text')
              span.setOutput(textBlock?.text ?? '')
              if (result.usage) {
                span.setTokens(result.usage.input_tokens, result.usage.output_tokens)
              }
              return result
            })
          }
        },
      })
    },
  }) as T
}
