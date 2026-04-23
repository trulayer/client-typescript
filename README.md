# TruLayer AI — TypeScript SDK

> **Status: Alpha.** APIs are pre-`1.0.0` and may change between minor releases.
> Pin a specific version in production until `1.0.0` ships.

TypeScript/JavaScript SDK for instrumenting AI applications and sending traces to TruLayer AI. Works in Node.js, Edge runtimes, and serverless environments.

- Documentation: https://docs.trulayer.ai
- Source: https://github.com/trulayer/client-typescript
- Issues: https://github.com/trulayer/client-typescript/issues

## Installation

```bash
npm install @trulayer/sdk
# or
pnpm add @trulayer/sdk
```

## Quick Start

```typescript
import { TruLayer } from "@trulayer/sdk";
import OpenAI from "openai";

const tl = new TruLayer({ apiKey: "tl_..." });

const client = new OpenAI();

// Auto-instrumented — traces sent automatically
await tl.trace("my-agent", async (trace) => {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
  });
  return response;
});
```

## Manual Instrumentation

```typescript
import { TruLayer } from "@trulayer/sdk";

const tl = new TruLayer({ apiKey: "tl_...", projectName: "my-project" });

await tl.trace(
  "rag-pipeline",
  async (trace) => {
    trace.setModel("gpt-4o"); // rolled-up model for the trace

    const docs = await trace.span("retrieve", "retrieval", async (span) => {
      const results = await retrieve(query);
      span.setOutput({ count: results.length });
      return results;
    });

    const answer = await trace.span("generate", "llm", async (span) => {
      const result = await llm.complete(prompt);
      span.setMetadata({ model: "gpt-4o", tokens: 512 });
      return result;
    });

    trace.setCost(0.0042); // optional rolled-up cost in USD
    // latency_ms is auto-derived from start to end of the trace block
  },
  { externalId: "req-42" }, // link to your own request id for idempotent ingest
);
```

## Auto-Instrumentation

```typescript
// Wrap OpenAI client
const openai = tl.instrumentOpenAI(new OpenAI());

// Wrap Anthropic client
const anthropic = tl.instrumentAnthropic(new Anthropic());
```

## Configuration

```typescript
const tl = new TruLayer({
  apiKey: "tl_...",
  projectName: "my-project",
  endpoint: "https://api.trulayer.ai",
  batchSize: 50,
  flushInterval: 2000, // ms
});
```

## Error Handling

The SDK is fire-and-forget: transient HTTP failures are retried with exponential backoff (up to 3 attempts) and eventually logged via `console.warn`. User code is never interrupted by network errors.

One failure mode is **non-retryable** and surfaced as a typed error: if the TruLayer API responds with HTTP 401 and an error code of `invalid_api_key` or `api_key_expired`, the SDK:

- Raises `InvalidAPIKeyError` internally (no retries, no backoff).
- Drops all queued traces and rejects subsequent `enqueue` calls on that client instance.
- Logs a single warning identifying the failure.

These are permanent configuration errors — retrying cannot succeed, so the SDK halts to avoid wasting requests.

```typescript
import { TruLayer, InvalidAPIKeyError } from "@trulayer/sdk";

const tl = new TruLayer({ apiKey: process.env.TRULAYER_API_KEY!, projectName: "my-project" });

// Recommended: fail fast at startup with a lightweight probe trace.
try {
  await tl.trace("startup-probe", async () => {});
  await tl.shutdown();
} catch (err) {
  if (err instanceof InvalidAPIKeyError) {
    console.error(err.message); // "API key is invalid or has expired — check your configuration."
    process.exit(1);
  }
  throw err;
}
```

`InvalidAPIKeyError` exposes a `code` field (`"invalid_api_key" | "api_key_expired"`) for programmatic handling.

## Runtime Compatibility

| Runtime | Supported |
| ------- | --------- |
| Node.js 18+ | ✅ |
| Edge (Vercel/CF Workers) | ✅ |
| Bun | ✅ |
| Browser | ⚠️ (use server-side relay) |

## Tech Stack

- TypeScript strict mode
- Zero runtime dependencies (uses native `fetch`)
- ESM + CJS dual build via `tsup`
- Full type safety end-to-end
- Compatible with: OpenAI SDK, Anthropic SDK, Vercel AI SDK, LangChain.js

## Development

```bash
pnpm install
pnpm test            # Vitest tests
pnpm test:coverage   # Coverage (target: >90%)
pnpm lint            # ESLint
pnpm type-check      # tsc --noEmit
pnpm build           # tsup bundle (ESM + CJS)
```

## Links

- [Documentation](https://docs.trulayer.ai)
- [API Reference](https://docs.trulayer.ai/api-reference)

