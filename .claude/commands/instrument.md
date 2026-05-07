---
description: Scaffold a new auto-instrumentation wrapper for a TypeScript AI provider. Usage: /instrument <provider> — e.g. /instrument openai
---

Scaffold an auto-instrumentation module for a TypeScript AI provider SDK. The argument is: $ARGUMENTS

Parse the argument as: <provider>
- provider: lowercase provider name (e.g. openai, anthropic, vercel-ai)

Generate this file:

**`src/instruments/<provider>.ts`**

```typescript
import type { TraceContext } from '../trace.js'

type <Provider>Client = {
  // TODO: narrow to the provider's actual completion interface
  chat: {
    completions: {
      create: (...args: unknown[]) => unknown
    }
  }
}

type CompletionParams = {
  model?: string
  messages?: Array<{ content?: string; role?: string }>
}

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Returns a new instrumented <Provider> client that records spans into `trace`.
 * Never mutates the original client — wraps methods on a new Proxy object.
 */
export function instrument<Provider><T extends <Provider>Client>(
  client: T,
  trace: TraceContext,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'chat') return Reflect.get(target, prop, receiver)

      return new Proxy(target.chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== 'completions')
            return Reflect.get(chatTarget, chatProp, chatReceiver)

          return new Proxy(chatTarget.completions, {
            get(compTarget, compProp, compReceiver) {
              if (compProp !== 'create')
                return Reflect.get(compTarget, compProp, compReceiver)

              return function (...args: [CompletionParams, ...unknown[]]) {
                const params = args[0] ?? {}
                const messages = params.messages ?? []
                const lastMsg = messages[messages.length - 1]
                const inputText =
                  typeof lastMsg?.content === 'string' ? lastMsg.content : ''

                return trace.span('<provider>.chat', 'llm', async (span) => {
                  span.setInput(inputText)
                  if (params.model) span.setModel(params.model)

                  const result = (await (
                    compTarget.create as (...args: unknown[]) => unknown
                  )(...args)) as CompletionResponse

                  const output = result.choices?.[0]?.message?.content ?? ''
                  span.setOutput(output)
                  if (result.usage) {
                    span.setTokens(
                      result.usage.prompt_tokens,
                      result.usage.completion_tokens,
                    )
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
```

Rules:
- Second parameter is always `trace: TraceContext` — never the top-level `TruLayer` client
- Use `trace.span(name, type, async (span) => { ... })` callback — latency, IDs, and flushing are handled automatically; never measure time or call `_batch.enqueue` directly
- Return type must be identical to the input type — the caller's TypeScript types should be unaffected
- Never mutate the original client object — always return a new Proxy
- Never throw into user code — `trace.span` swallows internal errors; do not hide the original provider error from the caller
- No `process`, `Buffer`, `node:*` imports — must be Edge runtime compatible
- No `any` — use `unknown` + type narrowing

After generating:
1. Export `instrument<Provider>` from `src/index.ts`.
2. Add a unit test in `tests/unit/instruments/<provider>.test.ts` — use `createTestClient()` from `src/testing.ts` to capture spans, then assert via `SenderAssertions` / `TraceAssertions`.
3. Run `pnpm type-check` to confirm the return type is correctly inferred.
4. Add an `@trulayer/sdk/node` export in `package.json` if the instrument requires Node-only APIs.
