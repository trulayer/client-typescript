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
  stream?: boolean
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Shape of an OpenAI streaming chunk (`ChatCompletionChunk`).
 * We use structural typing to avoid importing `openai` at runtime.
 */
type ChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

/**
 * Wraps an async iterable of OpenAI chunks, accumulating content and
 * closing the span when iteration completes or errors.
 *
 * The returned object exposes `[Symbol.asyncIterator]` so it is a
 * drop-in replacement for OpenAI's `Stream<ChatCompletionChunk>`.
 */
function wrapOpenAIStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we intentionally accept any async iterable shape from the provider
  original: AsyncIterable<any>,
  span: { setOutput: (v: string) => void; setTokens: (p?: number, c?: number) => void },
  resolve: (value: void) => void,
  reject: (err: unknown) => void,
): AsyncIterable<ChatCompletionChunk> {
  let buffer = ''
  let promptTokens: number | undefined
  let completionTokens: number | undefined

  return {
    [Symbol.asyncIterator]() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider type is unknown at compile time
      const iterator = (original as AsyncIterable<any>)[Symbol.asyncIterator]()
      return {
        async next() {
          try {
            const result = await iterator.next()
            if (result.done) {
              span.setOutput(buffer)
              span.setTokens(promptTokens, completionTokens)
              resolve()
              return result as IteratorResult<ChatCompletionChunk>
            }
            const chunk = result.value as ChatCompletionChunk
            const delta = chunk.choices?.[0]?.delta?.content
            if (typeof delta === 'string') {
              buffer += delta
            }
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens
              completionTokens = chunk.usage.completion_tokens ?? completionTokens
            }
            return { done: false, value: chunk } as IteratorResult<ChatCompletionChunk>
          } catch (err) {
            reject(err)
            throw err
          }
        },
        async return(value?: unknown) {
          // Consumer broke out of for-await early — close the span with what we have
          span.setOutput(buffer)
          span.setTokens(promptTokens, completionTokens)
          resolve()
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

              return function (...args: [ChatCompletionParams, ...unknown[]]) {
                const params = args[0] ?? {}
                const messages = params.messages ?? []
                const lastMsg = messages[messages.length - 1]
                const inputText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''
                const isStream = params.stream === true

                if (isStream) {
                  // Streaming path: open a span, return the wrapped iterable immediately.
                  // The span stays open until the consumer exhausts the iterable.
                  let resolveSpan: (value: void) => void
                  let rejectSpan: (err: unknown) => void
                  const spanDone = new Promise<void>((res, rej) => {
                    resolveSpan = res
                    rejectSpan = rej
                  })

                  // We kick off the span but don't await it — the span callback
                  // waits for `spanDone` which resolves when the stream ends.
                  // The outer function returns the wrapped iterable synchronously
                  // (wrapped in a Promise that resolves once we have the iterable).
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- return type must match provider's overloaded signatures
                  let wrappedIterable: any
                  const spanPromise = trace.span('openai.chat', 'llm', async (span) => {
                    span.setInput(inputText)
                    if (params.model) span.setModel(params.model)

                    const result = await (compTarget.create as (...args: unknown[]) => unknown)(
                      ...args,
                    )
                    wrappedIterable = wrapOpenAIStream(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider returns unknown async iterable
                      result as AsyncIterable<any>,
                      span,
                      resolveSpan!,
                      rejectSpan!,
                    )

                    // Wait for the consumer to exhaust the stream before the span closes
                    await spanDone
                  })

                  // Surface span errors (they propagate via spanPromise)
                  spanPromise.catch(() => {
                    /* span error handling is internal */
                  })

                  // Return a promise that resolves to the wrapped iterable once
                  // the original create call completes (but before streaming starts)
                  return (async () => {
                    // Wait for the original create to return + wrappedIterable to be set.
                    // We poll briefly — the create() call is awaited inside the span.
                    // A cleaner way: use another deferred.
                    await new Promise<void>((resolve) => {
                      const check = (): void => {
                        if (wrappedIterable !== undefined) {
                          resolve()
                        } else {
                          // Yield to the microtask queue
                          Promise.resolve().then(check)
                        }
                      }
                      check()
                    })
                    return wrappedIterable
                  })()
                }

                // Non-streaming path: original behavior
                return (async () => {
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
                })()
              }
            },
          })
        },
      })
    },
  }) as T
}
