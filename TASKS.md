# TypeScript SDK — Implementation Tasks

**Due Date: 2026-04-30**

Track implementation progress for the `@trulayer/sdk` npm package.

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1: Core SDK

### Project Setup

- [x] Initialize `package.json` (name: `@trulayer/sdk`)
- [x] Add `uuidv7` dependency (for generating UUIDv7 trace/span IDs)
- [x] Configure TypeScript (`tsconfig.json`, strict mode)
- [x] Configure `tsup` for ESM + CJS dual build
- [x] Set up Vitest + coverage (44 tests, 98% lines, 90% branches)
- [x] Set up ESLint + Prettier
- [x] CI pipeline: lint, type-check, test, build

### Core Types

- [x] `Trace`, `Span`, `Event`, `Feedback` TypeScript interfaces
- [x] `TruLayerConfig` interface (apiKey, project, environment, endpoint, batchSize, etc.)
- [x] `SpanType` type (`llm`, `tool`, `retrieval`, `default`)

### Client & Init

- [x] `TruLayer` class with constructor accepting `TruLayerConfig`
- [x] Global `init()` singleton factory
- [x] Config validation on init (throw if `apiKey`/`projectId` missing)

### Trace & Span

- [x] `tl.trace(name, callback)` — wraps callback, auto-closes trace on return/throw
- [x] `trace.span(name, type, callback)` — wraps callback, auto-closes span
- [x] Auto-capture start/end timestamps, error status
- [x] `span.setInput()`, `span.setOutput()`, `span.setMetadata()`
- [x] **Nested span support (parent_span_id)** ← top priority (foundational SDK correctness)
- [x] All IDs (`trace_id`, `span_id`) generated with `uuidv7()` from the `uuidv7` package

### Batch Sender

- [x] In-memory event buffer (array + size/time flush triggers)
- [x] `setTimeout`-based flush loop (Edge-compatible)
- [x] `fetch`-based HTTP batch POST to `/v1/ingest/batch`
- [x] Retry with exponential backoff (3 retries)
- [x] Drop + `console.warn` on max retries (never throw)
- [x] `flush()` method for manual drain
- [x] `shutdown()` method for graceful shutdown
- [x] Non-retryable 401 handling — raise `InvalidAPIKeyError` on `invalid_api_key` / `api_key_expired`, halt queue

### Auto-Instrumentation

- [x] `instrumentOpenAI(client)` — wraps `chat.completions.create`, returns typed Proxy client
- [x] `instrumentAnthropic(client)` — wraps `messages.create`, returns typed Proxy client
- [x] `instrumentVercelAI()` — wraps `generateText`, `streamText`, `generateObject`; zero `ai` dep (loose typing)

### Feedback

- [x] `tl.feedback(traceId, label, options?)` — fire-and-forget POST, warns on failure

### Node.js Extras (`@trulayer/sdk/node`)

- [x] `process.once('beforeExit')` + `SIGTERM` flush hooks
- [x] Node.js-specific `init()` with process lifecycle management

---

## Phase 2: V1 Enhancements

- [x] **`instrumentLangChainJS()` — LangChain.js callback handler** ← top priority
- [x] Streaming support: capture streamed token chunks
- [x] Sampling rate (skip sending X% of traces)
- [x] PII redaction callback hook

---

## Deferred (non-feature — see Linear for priority)

- [x] Browser compatibility via `@trulayer/sdk/browser` (relay through API route)
- [x] Local/offline sandbox mode (`TRULAYER_MODE=local`, `@trulayer/sdk/testing`) — TRU-81

---

## Engineering Checklist (per PR)

- [ ] Tests written (>90% coverage for new code)
- [ ] `pnpm type-check` passes (zero type errors)
- [ ] `pnpm lint` passes
- [ ] Passes in Node, Edge, and Bun environments
- [ ] Zero new runtime dependencies added (except `uuidv7`)
- [ ] Public API changes reflected in README
- [ ] Breaking changes bump minor version
