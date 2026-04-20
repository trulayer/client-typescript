---
description: Scaffold a new auto-instrumentation wrapper for a TypeScript AI provider. Usage: /instrument <provider> — e.g. /instrument openai
---

Scaffold an auto-instrumentation module for a TypeScript AI provider SDK. The argument is: $ARGUMENTS

Parse the argument as: <provider>
- provider: lowercase provider name (e.g. openai, anthropic, vercel-ai)

Generate this file:

**`src/instruments/<provider>.ts`**

```typescript
import type { TruLayer } from '../client'
import type { SpanInput } from '../model'

/**
 * Returns a new instrumented instance of the <Provider> client.
 * Never mutates the original client — wraps methods on a new proxy object.
 */
export function instrument<Provider>(
  client: <ProviderClient>,
  tl: TruLayer,
): <ProviderClient> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)

      if (prop === 'chat' /* adjust to provider's completion method */) {
        return new Proxy(original, {
          get(chatTarget, chatProp, chatReceiver) {
            const chatOriginal = Reflect.get(chatTarget, chatProp, chatReceiver)
            if (chatProp === 'completions' || chatProp === 'create') {
              return async function (...args: unknown[]) {
                const start = Date.now()
                const result = await (chatOriginal as Function).apply(chatTarget, args)
                const latencyMs = Date.now() - start

                const span: SpanInput = {
                  name: '<provider>.completion',
                  input: JSON.stringify(args[0]),
                  output: JSON.stringify(result),
                  latencyMs,
                  model: (args[0] as Record<string, unknown>)?.model as string ?? '',
                }
                tl.span(span) // fire-and-forget, never throws

                return result
              }
            }
            return chatOriginal
          },
        })
      }

      return original
    },
  })
}
```

Rules:
- Return type must be identical to the input type — the caller's TypeScript types should be unaffected
- Never mutate the original client object
- Never throw into user code — wrap in try/catch, silently drop on error
- No `process`, `Buffer`, `node:*` imports — must be Edge runtime compatible
- No `any` — use `unknown` + type narrowing

After generating:
1. Export `instrument<Provider>` from `src/index.ts`.
2. Add a unit test in `tests/unit/instruments/<provider>.test.ts` — mock `fetch` via `vi.stubGlobal` and verify spans are enqueued.
3. Run `pnpm type-check` to confirm the return type is correctly inferred.
4. Add an `@trulayer/sdk/node` export in `package.json` if the instrument requires Node-only APIs.
