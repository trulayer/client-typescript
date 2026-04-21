# CLAUDE.md — TypeScript SDK (client-typescript)

## Project Purpose

The `@trulayer/sdk` npm package. Provides trace capture, span instrumentation, and auto-instrumentation hooks for OpenAI, Anthropic, and Vercel AI SDK. Works in Node.js, Edge runtimes (Vercel Edge, Cloudflare Workers), and Bun.

## Tech Stack

- TypeScript (strict mode)
- Zero runtime dependencies — uses native `fetch`
- `tsup` — dual ESM + CJS bundle with `.d.ts` generation
- `vitest` — tests (Node and Edge runtime modes)
- ESLint + Prettier — lint/format
- Node.js 18+, Edge runtime, Bun compatible

## Definition of Done

A task is **not done** until all of the following are true — in order:

1. **Tests pass** — `pnpm type-check` and `pnpm test` both green. Unit tests must land in the same change.
2. **Committed on a feature branch** — all changed files committed on a branch named `feat/...` or `fix/...`. **Never commit directly to `main`.**
3. **PR opened** — `gh pr create` targeting `main` with a summary of what changed and why.
4. **PR merged** — `gh pr merge --squash`. Work on the next task cannot begin until this PR is merged.

**Direct pushes to `main` are forbidden.** Every change must go through a pull request.

## CI is gating

Every pull request must pass CI before it can be merged. If CI fails, the engineer who opened the PR owns the fix — not a reviewer, not a follow-up task. Don't merge with failing CI. Don't bypass with `--admin` or `--no-verify`. If a check is flaky, fix it or remove it — don't skip it.

## Key Commands

```bash
pnpm install            # Install deps
pnpm dev                # tsc --watch (type checking in watch mode)
pnpm build              # tsup (ESM + CJS + types)
pnpm test               # Vitest unit tests
pnpm test:coverage      # Coverage (target: >90%)
pnpm test:edge          # Run tests in Edge runtime via vitest-edge
pnpm lint               # ESLint
pnpm type-check         # tsc --noEmit
pnpm format             # Prettier
```

## Project Layout

```text
src/
  index.ts              → public API exports
  client.ts             → TruLayer class (init, config)
  trace.ts              → trace() and span() functions
  batch.ts              → async batch sender
  model.ts              → TypeScript types (Trace, Span, etc.)
  instruments/
    openai.ts           → OpenAI auto-instrumentation
    anthropic.ts        → Anthropic auto-instrumentation
    vercel-ai.ts        → Vercel AI SDK middleware
tests/
  unit/                 → Vitest unit tests (mocked fetch)
  integration/          → Tests against mock server
dist/                   → tsup output (gitignored)
```

## Coding Conventions

- TypeScript strict mode — no `any`, no `@ts-ignore` without comment
- Zero runtime dependencies — never add dependencies that break Edge compatibility
- Use native `fetch` (available in Node 18+, Edge, Bun)
- All async operations use `Promise` — no callbacks
- Exports: named exports only, no default exports (tree-shakeable)
- `trace()` and `span()` use callback pattern for automatic cleanup

## Batch Sender Behavior

- Buffer events and flush on `batchSize` (default: 50) or `flushInterval` (default: 2000ms)
- Use `setTimeout`-based flush loop (compatible with Edge runtimes — no `setInterval` in some)
- On `unload`/`beforeunload` in Node, attempt synchronous flush via `fetch` with `keepalive: true`
- HTTP failures retry up to 3 times with exponential backoff
- After max retries, drop events (never throw into user code)

## Edge Runtime Compatibility

- No `process`, `Buffer`, `node:*` imports in core SDK
- Use `globalThis.fetch`, `globalThis.setTimeout`
- IDs (trace_id, span_id) are **UUIDv7** — use the `uuidv7` npm package (`uuidv7()`) for client-side generation, not `crypto.randomUUID()` (which produces UUIDv4)
- Node-only features (e.g., `process.exit` hook) go in a separate `node` export: `@trulayer/sdk/node`

## Auto-Instrumentation

Wraps provider client methods. Returns a new instrumented instance (never mutates the original):

```typescript
const openai = tl.instrumentOpenAI(new OpenAI()) // returns wrapped client
```

Wrapping must be type-safe — the returned type must be identical to the input type.

## Testing

- Unit tests mock `fetch` via `vitest`'s `vi.stubGlobal('fetch', mockFetch)`
- Test trace/span callback lifecycle, batching, retry behavior
- Edge runtime tests run via `vitest-environment-edge`
- Coverage target: **90%**
- All tests must pass in Node, Edge, and Bun environments

## Build Output

`tsup` produces three entry points:

- `dist/index.js` / `dist/index.cjs` / `dist/index.d.ts` — main entry
- `dist/node.js` / `dist/node.cjs` / `dist/node.d.ts` — Node.js extras (`@trulayer/sdk/node`)
- `dist/browser.js` / `dist/browser.cjs` / `dist/browser.d.ts` — browser relay mode (`@trulayer/sdk/browser`)

Package `exports` in `package.json` maps `import` → ESM, `require` → CJS for each entry.

## Public Repository Policy

This repository ships to TruLayer customers. Do not introduce references to internal code, internal repositories (e.g. the TruLayer API service or dashboard), internal planning documents, internal Linear issue content, or internal architectural details. Refer to the platform as "TruLayer" or "the TruLayer API" — not as specific internal components. If in doubt, leave it out.
