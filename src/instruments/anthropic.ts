import type { TraceContext } from '../trace.js'

type AnthropicClient = {
  messages: {
    create: (...args: unknown[]) => unknown
  }
}

type MessageParams = {
  model?: string
  messages?: Array<{ content?: string; role?: string }>
  stream?: boolean
}

type MessageResponse = {
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Shape of Anthropic streaming events (`MessageStreamEvent`).
 * Structural typing — no runtime dependency on `@anthropic-ai/sdk`.
 */
type MessageStreamEvent = {
  type?: string
  delta?: { type?: string; text?: string }
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  usage?: { output_tokens?: number }
}

/**
 * Wraps an async iterable of Anthropic stream events, accumulating text
 * from `content_block_delta` events and closing the span on `message_stop`.
 */
function wrapAnthropicStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider type is unknown at compile time
  original: AsyncIterable<any>,
  span: { setOutput: (v: string) => void; setTokens: (p?: number, c?: number) => void },
  resolve: (value: void) => void,
  reject: (err: unknown) => void,
): AsyncIterable<MessageStreamEvent> {
  let buffer = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let closed = false

  function closeSpan(): void {
    if (closed) return
    closed = true
    span.setOutput(buffer)
    span.setTokens(inputTokens, outputTokens)
    resolve()
  }

  return {
    [Symbol.asyncIterator]() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider type unknown
      const iterator = (original as AsyncIterable<any>)[Symbol.asyncIterator]()
      return {
        async next() {
          try {
            const result = await iterator.next()
            if (result.done) {
              closeSpan()
              return result as IteratorResult<MessageStreamEvent>
            }
            const event = result.value as MessageStreamEvent
            if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
              buffer += event.delta.text
            }
            if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? inputTokens
            }
            if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens ?? outputTokens
            }
            if (event.type === 'message_stop') {
              closeSpan()
            }
            return { done: false, value: event } as IteratorResult<MessageStreamEvent>
          } catch (err) {
            reject(err)
            throw err
          }
        },
        async return(value?: unknown) {
          closeSpan()
          if (typeof iterator.return === 'function') {
            return iterator.return(value)
          }
          return { done: true, value: undefined } as IteratorReturnResult<undefined>
        },
        async throw(err?: unknown) {
          reject(err)
          if (typeof iterator.throw === 'function') {
            return iterator.throw(err)
          }
          throw err
        },
      }
    },
  }
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

          return function (...args: [MessageParams, ...unknown[]]) {
            const params = args[0] ?? {}
            const messages = params.messages ?? []
            const lastMsg = messages[messages.length - 1]
            const inputText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''
            const isStream = params.stream === true

            if (isStream) {
              let resolveSpan: (value: void) => void
              let rejectSpan: (err: unknown) => void
              const spanDone = new Promise<void>((res, rej) => {
                resolveSpan = res
                rejectSpan = rej
              })

              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- return type must match provider's overloaded signatures
              let wrappedIterable: any
              const spanPromise = trace.span('anthropic.messages', 'llm', async (span) => {
                span.setInput(inputText)
                if (params.model) span.setModel(params.model)

                const result = await (msgTarget.create as (...args: unknown[]) => unknown)(
                  ...args,
                )
                wrappedIterable = wrapAnthropicStream(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider returns unknown async iterable
                  result as AsyncIterable<any>,
                  span,
                  resolveSpan!,
                  rejectSpan!,
                )

                await spanDone
              })

              spanPromise.catch(() => {
                /* span error handling is internal */
              })

              return (async () => {
                await new Promise<void>((resolve) => {
                  const check = (): void => {
                    if (wrappedIterable !== undefined) {
                      resolve()
                    } else {
                      Promise.resolve().then(check)
                    }
                  }
                  check()
                })
                return wrappedIterable
              })()
            }

            // Non-streaming path
            return (async () => {
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
            })()
          }
        },
      })
    },
  }) as T
}
