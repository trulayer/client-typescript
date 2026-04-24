# TruLayer AI — TypeScript SDK

[![codecov](https://codecov.io/gh/trulayer/client-typescript/graph/badge.svg?token=1Q01FL9TJJ)](https://codecov.io/gh/trulayer/client-typescript)

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
import {
  instrumentOpenAI,
  instrumentAnthropic,
  instrumentVercelAI,
  instrumentVercelAITools,
  instrumentMastraAgent,
  instrumentMastraWorkflow,
  instrumentLlamaIndexQueryEngine,
  instrumentLlamaIndexRetriever,
} from "@trulayer/sdk";

await tl.trace("my-agent", async (trace) => {
  const openai = instrumentOpenAI(new OpenAI(), trace);
  const anthropic = instrumentAnthropic(new Anthropic(), trace);
});
```

### Supported frameworks

| Framework          | Helper(s)                                                              | Span kinds captured                                              |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| OpenAI             | `instrumentOpenAI`                                                     | `chat.completions.create` (+ stream)                             |
| Anthropic          | `instrumentAnthropic`                                                  | `messages.create` (+ stream)                                     |
| Vercel AI SDK      | `instrumentVercelAI`, `instrumentVercelAITools`                        | `generateText`, `streamText`, `generateObject`, tool invocations |
| LangChain.js       | `TruLayerCallbackHandler`                                              | LLM / chain / tool callbacks                                     |
| Mastra             | `instrumentMastraAgent`, `instrumentMastraWorkflow`                    | agent `.generate()` / `.stream()`, workflow + step `.execute()`  |
| LlamaIndex.TS      | `instrumentLlamaIndexQueryEngine`, `instrumentLlamaIndexRetriever`     | `QueryEngine.query()`, `Retriever.retrieve()`                    |

Emitted span metadata follows the OpenTelemetry GenAI semantic conventions where applicable (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `gen_ai.tool.call.id`). Token and model attributes are populated only when the upstream framework exposes them; missing fields are omitted gracefully.

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

## Failure behavior

The SDK is designed so that a TruLayer ingest outage never becomes an application outage.

**Default — drop and warn.** When the ingest API is unreachable or returns a transient error (5xx, network failure), the SDK retries each batch up to **3× with exponential backoff** (500ms / 1s / 2s). After the third failure the batch is dropped and a single `console.warn` is emitted. Subsequent batch failures within a 60-second window are silently dropped to avoid log flooding; a fresh warning is emitted once the window rolls over.

User code never blocks on network I/O and never sees an ingest failure propagate as an exception. Trace capture runs in-process; transport runs on a background flush loop.

**Opt-in — block on failure.** Set `TRULAYER_FAIL_MODE=block` to make `client.shutdown()` (and explicit `flush()` waits on shutdown) raise `TruLayerFlushError` when a batch exhausts its retries. Use this only on critical paths where losing traces silently is worse than bubbling an error to the caller. It is discouraged as a default — a dead ingest endpoint will take your workers down with it.

```typescript
import { TruLayer, TruLayerFlushError } from "@trulayer/sdk";

// Either TRULAYER_FAIL_MODE=block in the environment, or construct with
// the option directly on a custom sender. `TruLayerFlushError` carries
// `batchSize` and the original `cause`.
process.env.TRULAYER_FAIL_MODE = "block";

const tl = new TruLayer({ apiKey: "tl_...", projectName: "critical-pipeline" });
try {
  await tl.trace("eval-run", async () => {
    /* ... */
  });
  await tl.shutdown();
} catch (err) {
  if (err instanceof TruLayerFlushError) {
    // Log, alert, or abort the pipeline deliberately.
  }
  throw err;
}
```

**Zero-network — local mode.** For CI and offline development, set `TRULAYER_MODE=local`. The SDK swaps the HTTP sender for an in-memory `LocalBatchSender` that stores traces for inspection, prints nothing to the wire, and never warns. Combine with `@trulayer/sdk/testing` for assertion helpers (see below).

**Replay.** Set `TRULAYER_MODE=replay` together with `TRULAYER_REPLAY_FILE=<path>` to load a previously captured JSONL file on `init()`. Useful for golden-file regression tests and reproducing production traces locally. Malformed lines are skipped with a warning, not surfaced as errors.

```typescript
// Capture, write to disk, replay elsewhere.
import { createTestClient, replay } from "@trulayer/sdk/testing";

const { client, sender } = createTestClient();
await client.trace("...", async (t) => {
  /* ... */
});
client.flush();
await sender.flushToFile("fixtures/golden.jsonl");

// In another process / test run:
const result = await replay({ file: "fixtures/golden.jsonl" });
console.log(`replayed ${result.replayed}, skipped ${result.skipped}`);
```

## Testing helpers (`@trulayer/sdk/testing`)

`@trulayer/sdk/testing` ships framework-agnostic utilities for writing unit tests against instrumented code without ever reaching the network. Works with Vitest, Jest, Mocha, or any runner that treats thrown errors as failures.

```typescript
import { createTestClient, assertSender } from "@trulayer/sdk/testing";

const { client, sender } = createTestClient();

await client.trace("rag-pipeline", async (trace) => {
  await trace.span("retrieve", "retrieval", async () => {
    /* ... */
  });
  await trace.span("generate", "llm", async (span) => {
    span.setModel("gpt-4o");
    span.setMetadata({ "gen_ai.system": "openai" });
  });
});
client.flush();

assertSender(sender)
  .hasTrace()
  .spanCount(2)
  .hasSpanNamed("retrieve")
  .hasAttribute("gen_ai.system", "openai")
  .hasAttribute("model", "gpt-4o");
```

- `createTestClient(overrides?)` — returns a `{ client, sender }` pair backed by `LocalBatchSender`. No API key required.
- `assertSender(sender)` — chainable assertions at the sender level (`hasTrace`, `spanCount`, `hasSpanNamed`). `hasTrace()` returns a per-trace chain with `spanCount`, `hasSpanNamed`, and `hasAttribute(key, value)`.
- `hasAttribute` matches span metadata first, then falls back to well-known top-level fields (`model`, `name`, `span_type`, `prompt_tokens`, `completion_tokens`) so assertions work regardless of where the instrumenter wrote the value.
- `sender.flushToFile(path)` / `replay({ file })` — see "Replay" above.

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

