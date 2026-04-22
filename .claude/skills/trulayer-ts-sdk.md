---
name: trulayer-ts-sdk
description: Use this skill when writing, debugging, or integrating @trulayer/sdk (TypeScript) — including init, trace(), span(), feedback(), auto-instrumentation of OpenAI/Anthropic/Vercel AI SDK/LangChain, redaction, and batch/flush behavior.
---

# @trulayer/sdk (TypeScript) — Skill

Authoritative reference for using the `@trulayer/sdk` npm package. All examples here mirror the actual exported surface — copy-paste safe.

The package is zero-dependency at runtime (uses native `fetch`), works in Node.js 18+, Edge runtimes (Vercel Edge, Cloudflare Workers), and Bun, and ships dual ESM + CJS bundles.

---

## 1. Install

```bash
npm install @trulayer/sdk
# or
pnpm add @trulayer/sdk
# or
yarn add @trulayer/sdk
```

**Subpath entry points:**

| Import path                  | Use when                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| `@trulayer/sdk`              | Default. Node, Edge, Bun, server frameworks.                      |
| `@trulayer/sdk/node`         | Node.js only — adds `beforeExit` / `SIGTERM` graceful shutdown.   |
| `@trulayer/sdk/browser`      | Browser code that posts through a server-side relay (no API key). |
| `@trulayer/sdk/testing`      | `createTestClient`, `assertSender`, `LocalBatchSender`.           |
| `@trulayer/sdk/redact`       | `Redactor`, `BUILTIN_PACKS`, `redact` (also re-exported by main). |

Do **not** import `@trulayer/sdk/node` from Edge runtime code — use the main entry there.

---

## 2. Init and config

There are two equivalent patterns. Pick one per process.

### Pattern A — global client (most apps)

```ts
import { init, getClient } from '@trulayer/sdk'

init({
  apiKey: process.env.TRULAYER_API_KEY!,
  projectName: 'checkout-bot',
})

// elsewhere in the codebase:
const tl = getClient()
```

`getClient()` throws if `init()` has not been called. Calling `init()` more than once replaces the global client and creates a fresh batch sender — call it exactly once at process startup.

### Pattern B — explicit client (multi-project, libraries)

```ts
import { TruLayer } from '@trulayer/sdk'

const tl = new TruLayer({
  apiKey: process.env.TRULAYER_API_KEY!,
  projectName: 'checkout-bot',
})
```

### Node.js extras

```ts
import { init } from '@trulayer/sdk/node'

const tl = init({ apiKey: '...', projectName: 'my-app' })
// `beforeExit` and `SIGTERM` handlers are registered automatically
// to flush the batch sender on shutdown.
```

### Config reference

```ts
interface TruLayerConfig {
  apiKey: string                                  // required (skipped in local mode)
  projectName?: string                            // required (skipped in local mode)
  projectId?: string                              // DEPRECATED, removed in 0.3.x
  endpoint?: string                               // default: 'https://api.trulayer.ai'
  batchSize?: number                              // default: 50
  flushInterval?: number                          // default: 2000 (ms)
  sampleRate?: number                             // 0.0–1.0, default: 1.0
  redact?: (data: unknown) => unknown             // see section 6
  relayUrl?: string                               // browser relay only
}
```

### Local mode (dev / CI)

Set `TRULAYER_MODE=local` and the SDK switches to an in-memory `LocalBatchSender` — no network calls, `apiKey`/`projectName` are not required, and a single one-time warning is logged. Use this in tests and dev to keep `init()` calls in your code without sending data.

---

## 3. Core call patterns

The five patterns below cover ~95% of usage.

### Pattern 1 — wrap a single LLM call

```ts
import { getClient } from '@trulayer/sdk'

const tl = getClient()

const result = await tl.trace('answer-question', async (trace) => {
  trace.setInput(userQuestion)
  const reply = await callMyModel(userQuestion)
  trace.setOutput(reply).setModel('gpt-4o').setCost(0.0021)
  return reply
})
```

The trace is enqueued automatically when the callback returns (or throws). The setters are chainable.

### Pattern 2 — nested span

`spanType` is **required** and must be one of `'llm' | 'tool' | 'retrieval' | 'chain' | 'default'`.

```ts
await tl.trace('rag-query', async (trace) => {
  const docs = await trace.span('vector-search', 'retrieval', async (span) => {
    span.setInput(query)
    const results = await vectorStore.search(query)
    span.setOutput(JSON.stringify(results.map((d) => d.id)))
    return results
  })

  await trace.span('llm-call', 'llm', async (span) => {
    span.setInput(buildPrompt(query, docs)).setModel('gpt-4o')
    const out = await callLLM(query, docs)
    span.setOutput(out).setTokens(412, 87)
  })
})
```

Spans nested inside other spans (via `span.span(...)`) automatically capture their parent's id through `AsyncLocalStorage` on Node and Bun. On Edge runtimes without `AsyncLocalStorage`, parent linkage falls back to explicit chaining only.

### Pattern 3 — auto-instrument OpenAI

`instrumentOpenAI` takes the client **and** the active trace, and returns a wrapped client of the same type. It does not mutate the original.

```ts
import OpenAI from 'openai'
import { getClient, instrumentOpenAI } from '@trulayer/sdk'

const openai = new OpenAI()

await getClient().trace('chat', async (trace) => {
  const tracedOpenAI = instrumentOpenAI(openai, trace)

  const completion = await tracedOpenAI.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
  })
  // span 'openai.chat' (type 'llm') is recorded automatically with
  // input, output, model, prompt_tokens, completion_tokens.
})
```

Works for both non-streaming and streaming (`stream: true`) calls — the wrapped async iterable closes the span when iteration ends.

### Pattern 4 — auto-instrument Anthropic

Same shape as OpenAI: `(client, trace)`, returns a wrapped client.

```ts
import Anthropic from '@anthropic-ai/sdk'
import { getClient, instrumentAnthropic } from '@trulayer/sdk'

const anthropic = new Anthropic()

await getClient().trace('chat', async (trace) => {
  const tracedAnthropic = instrumentAnthropic(anthropic, trace)

  const message = await tracedAnthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  })
  // span 'anthropic.messages' (type 'llm') recorded automatically.
})
```

Streaming is supported the same way — the span closes on `message_stop` or when the consumer breaks out early.

### Pattern 5 — submit feedback

```ts
import { getClient } from '@trulayer/sdk'

getClient().feedback(traceId, 'good', {
  score: 1,
  comment: 'User clicked thumbs-up',
  metadata: { userId: 'user_123' },
})
```

`feedback` is fire-and-forget (returns `void`, never throws). `label` is a free-form string — common conventions are `'good' | 'bad' | 'neutral'`.

---

## 4. Vercel AI SDK

`instrumentVercelAI` wraps the AI SDK functions you pass in. Pass them as a record alongside the active trace:

```ts
import { generateText, streamText, generateObject } from 'ai'
import { getClient, instrumentVercelAI } from '@trulayer/sdk'

await getClient().trace('summarize', async (trace) => {
  const ai = instrumentVercelAI({ generateText, streamText, generateObject }, trace)

  const { text } = await ai.generateText({
    model: openai('gpt-4o'),
    prompt: 'Summarize the war of 1812 in three sentences.',
  })
})
```

Each wrapped call records a span (`vercel-ai.generateText`, `vercel-ai.streamText`, `vercel-ai.generateObject`, all type `'llm'`). Pass only the functions you actually use — omitted keys return `undefined`.

`streamText` is synchronous and returns an object with async `text` / `usage` — the wrapped span closes when those promises settle.

---

## 5. LangChain.js

`TruLayerCallbackHandler` is a structurally-typed handler that hooks into LangChain's `callbacks` array. No runtime dependency on `@langchain/core`.

```ts
import { getClient, TruLayerCallbackHandler } from '@trulayer/sdk'

await getClient().trace('rag-chain', async (trace) => {
  const handler = new TruLayerCallbackHandler(trace)
  await chain.invoke({ input: query }, { callbacks: [handler] })
})
```

It opens spans for `LLMStart` / `ChainStart` / `ToolStart` and closes them on the matching `End` / `Error` event.

---

## 6. Tagging, metadata, sampling

```ts
await tl.trace(
  'answer',
  async (trace) => { /* ... */ },
  {
    sessionId: 'sess_abc',
    externalId: 'order_42',
    tags: ['env:prod', 'model:gpt-4o', 'tier:premium'],
    metadata: { userId: 'user_123', plan: 'pro' },
  },
)
```

After the trace starts you can also call `trace.addTag('experiment:b')` and `trace.setMetadata({ extra: 1 })` — both chainable.

Do not put PII directly into `metadata`; use the `redact` config (next section) or pre-hash the value.

`sampleRate: 0.1` on `init()` keeps 10% of traces; sampled-out callbacks still execute, but no data is sent.

---

## 7. Redaction

The SDK ships a runtime-agnostic `Redactor` (regex packs + optional HMAC pseudonymization). Wire it through the `redact` callback on `init()` so every trace and span input/output passes through it before being enqueued.

```ts
import { init, Redactor } from '@trulayer/sdk'

const r = new Redactor({
  packs: ['standard', 'secrets'],          // 'standard' | 'strict' | 'phi' | 'finance' | 'secrets'
  pseudonymize: true,
  pseudonymizeSalt: process.env.REDACT_SALT!,
})

init({
  apiKey: process.env.TRULAYER_API_KEY!,
  projectName: 'checkout-bot',
  redact: (data) => (typeof data === 'string' ? r.redact(data) : data),
})
```

`Redactor.redact(text)` returns the scrubbed string. The SDK only calls `redact` on `input` and `output` values — it passes `unknown`, so the adapter above guards on `string`.

For one-off scrubbing you can use the convenience helper:

```ts
import { redact } from '@trulayer/sdk'
const safe = redact('contact alice@example.com', { packs: ['standard'] })
```

`Redactor.redactSpan(span, fields?)` returns a new object with the listed dotted paths scrubbed (default: `['input', 'output', 'metadata']`). Useful for post-processing captured test traces.

---

## 8. Flush, shutdown, serverless

The batch sender flushes on `batchSize` (50) or `flushInterval` (2000 ms), whichever comes first.

In short-lived environments (serverless functions, scripts) call `flush()` or `await shutdown()` before the handler returns, otherwise buffered spans may be dropped:

```ts
export async function POST(req: Request) {
  const tl = getClient()
  const result = await tl.trace('handle-request', async (trace) => { /* ... */ })
  await tl.shutdown()                       // graceful: flush + stop the timer loop
  return Response.json(result)
}
```

If you only want to push the buffer without tearing down the sender (e.g. between iterations of a long loop), call `tl.flush()` — it's synchronous and never throws.

When using `@trulayer/sdk/node`, `beforeExit` and `SIGTERM` already trigger `shutdown()`; you usually don't need to call it explicitly there.

---

## 9. Browser usage

Direct browser calls would expose the API key and hit CORS. Use the browser entry point with a server-side relay route:

```ts
// app/api/trulayer/route.ts (server)
export async function POST(req: Request) {
  const body = await req.text()
  return fetch('https://api.trulayer.ai/v1/traces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TRULAYER_API_KEY}`,
    },
    body,
  })
}
```

```ts
// client component
import { initBrowser } from '@trulayer/sdk/browser'

const tl = initBrowser({
  apiKey: 'unused-but-required-by-type',
  projectName: 'web-app',
  relayUrl: '/api/trulayer',
})
```

The browser sender posts to `relayUrl` with `credentials: 'include'` and **no** `Authorization` header — the relay attaches credentials.

---

## 10. Staging vs prod

```ts
init({
  apiKey: process.env.TRULAYER_STAGING_API_KEY!,
  projectName: 'checkout-bot',
  endpoint: 'https://api.staging.trulayer.ai',
})
```

Use a staging API key from your workspace settings. Without `endpoint`, the SDK targets `https://api.trulayer.ai`.

---

## 11. Testing

The `@trulayer/sdk/testing` entry point (also re-exported from the main entry) ships a no-network client and a fluent assertion helper.

```ts
import { describe, it, expect } from 'vitest'
import { createTestClient, assertSender } from '@trulayer/sdk/testing'

describe('answer flow', () => {
  it('records a trace with one llm span', async () => {
    const { client, sender } = createTestClient()

    await client.trace('answer', async (trace) => {
      await trace.span('llm-call', 'llm', async (span) => {
        span.setInput('hi').setOutput('hello').setModel('gpt-4o')
      })
    })
    await client.shutdown()

    assertSender(sender)
      .hasTrace()                       // at least one trace captured
      .spanCount(1)
      .hasSpanNamed('llm-call')

    // raw access:
    expect(sender.traces[0]?.name).toBe('answer')
    expect(sender.spans[0]?.span_type).toBe('llm')
  })
})
```

Available assertions on `assertSender(sender)` (chainable, throw on failure):

- `hasTrace(traceId?)` — at least one trace, optionally with a specific id
- `spanCount(n)` — exact span count across all traces
- `hasSpanNamed(name)` — at least one span with the given name

For ad-hoc checks use the raw arrays: `sender.traces`, `sender.spans`, `sender.batches`. Call `sender.clear()` between tests if you reuse the same instance.

You can also set `TRULAYER_MODE=local` in CI — every `init()` / `new TruLayer(...)` then uses a `LocalBatchSender` automatically with no code changes.

---

## 12. Common mistakes (avoid these)

- **Using `projectId` instead of `projectName`** — `projectId` is a deprecated alias; the SDK warns at runtime and it will be removed in 0.3.x.
- **Calling `init()` more than once** — replaces the global client and starts a second batch-sender timer. Call once per process; use `getClient()` everywhere else.
- **Forgetting to await `shutdown()` in serverless handlers** — buffered spans are dropped if the function returns before the next flush tick (default 2 s).
- **Missing the `spanType` argument on `trace.span(...)`** — it is required. Use `'default'` if nothing else fits.
- **Passing only the OpenAI/Anthropic client to `instrumentOpenAI` / `instrumentAnthropic`** — the second argument (the active `TraceContext` from `tl.trace(...)`) is required.
- **Mutating the original provider client** — `instrumentOpenAI` / `instrumentAnthropic` return a *new* proxied instance; the original is unchanged. Use the returned value.
- **Calling `instrumentVercelAI(generateText, trace)`** — wrong shape. The first argument is a record: `instrumentVercelAI({ generateText, streamText, generateObject }, trace)`.
- **Importing `@trulayer/sdk/node` in Edge runtime code** — use the main entry; the Node entry references `process` lifecycle hooks that don't exist on Edge.
- **Passing a `Redactor` instance directly to `redact:`** — the config field expects a function `(data: unknown) => unknown`. Wrap with `(d) => typeof d === 'string' ? r.redact(d) : d`.
- **Putting raw PII in `metadata` or `tags`** — those fields are not run through the `redact` callback (only `input` / `output` are). Pre-scrub or hash before attaching.
