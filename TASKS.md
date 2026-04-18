# TypeScript SDK — Implementation Tasks

Track implementation progress for the `@trulayer/sdk` npm package.

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1: Core SDK — [TRU-16](https://linear.app/omnimoda/issue/TRU-16)

### Project Setup

- [ ] Initialize `package.json` (name: `@trulayer/sdk`)
- [ ] Add `uuidv7` dependency (for generating UUIDv7 trace/span IDs)
- [ ] Configure TypeScript (`tsconfig.json`, strict mode)
- [ ] Configure `tsup` for ESM + CJS dual build
- [ ] Set up Vitest + coverage
- [ ] Set up ESLint + Prettier
- [ ] CI pipeline: lint, type-check, test, build

### Core Types — [TRU-8](https://linear.app/omnimoda/issue/TRU-8)

- [ ] `Trace`, `Span`, `Event`, `Feedback` TypeScript interfaces
- [ ] `TruLayerConfig` interface (apiKey, project, environment, endpoint, batchSize, etc.)
- [ ] `SpanType` enum (`llm`, `tool`, `retrieval`, `chain`)

### Client & Init

- [ ] `TruLayer` class with constructor accepting `TruLayerConfig`
- [ ] Global `init()` singleton factory
- [ ] Config validation on init (throw if `apiKey` missing)

### Trace & Span

- [ ] `tl.trace(name, callback)` — wraps callback, auto-closes trace on return/throw
- [ ] `trace.span(name, type, callback)` — wraps callback, auto-closes span
- [ ] Auto-capture start/end timestamps, error status
- [ ] `span.setInput()`, `span.setOutput()`, `span.setMetadata()`
- [ ] Nested span support (parent_span_id)
- [ ] All IDs (`trace_id`, `span_id`) generated with `uuidv7()` from the `uuidv7` package

### Batch Sender

- [ ] In-memory event buffer (array + size/time flush triggers)
- [ ] `setTimeout`-based flush loop (Edge-compatible)
- [ ] `fetch`-based HTTP batch POST to `/v1/ingest/batch`
- [ ] Retry with exponential backoff (3 retries, jitter)
- [ ] Drop + `console.warn` on max retries (never throw)
- [ ] `flush()` method for manual drain
- [ ] `shutdown()` method for graceful shutdown

### Auto-Instrumentation

- [ ] `instrumentOpenAI(client)` — wraps `chat.completions.create`, returns typed client
- [ ] `instrumentAnthropic(client)` — wraps `messages.create`
- [ ] `instrumentVercelAI()` — middleware for `streamText`, `generateText`, `generateObject`

### Feedback

- [ ] `tl.feedback(traceId, score, label?, comment?)` — submit feedback

### Node.js Extras (`@trulayer/sdk/node`)

- [ ] `process.on('beforeExit')` flush hook
- [ ] Node.js-specific `init()` with process lifecycle management

---

## Phase 2: V1 Enhancements

- [ ] `instrumentLangChainJS()` — LangChain.js callback handler
- [ ] Streaming support: capture streamed token chunks
- [ ] Sampling rate (skip sending X% of traces)
- [ ] PII redaction callback hook
- [ ] Browser compatibility via `@trulayer/sdk/browser` (relay through API route)

---

## Engineering Checklist (per PR)

- [ ] Tests written (>90% coverage for new code)
- [ ] `pnpm type-check` passes (zero type errors)
- [ ] `pnpm lint` passes
- [ ] Passes in Node, Edge, and Bun environments
- [ ] Zero new runtime dependencies added (except `uuidv7`)
- [ ] Public API changes reflected in README
- [ ] Breaking changes bump minor version
