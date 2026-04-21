# TruLayer AI — TypeScript SDK

TypeScript/JavaScript SDK for instrumenting AI applications and sending traces to TruLayer AI. Works in Node.js, Edge runtimes, and serverless environments.

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

