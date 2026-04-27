---
description: Scaffold TruLayer SDK initialization for a TypeScript or JavaScript project. Usage: /tl-init
---

Set up the TruLayer SDK in the current project. No arguments needed.

## What to do

1. Check if `@trulayer/sdk` is already in `package.json`. If not, add it.
2. Find or create an initialization file (e.g. `src/lib/trulayer.ts` or `src/instrumentation.ts`).
3. Add the initialization block below.

### Initialization file

```typescript
// src/lib/trulayer.ts
import { init } from '@trulayer/sdk'

export const tl = init({
  apiKey: process.env.TRULAYER_API_KEY ?? '',
  // project: 'my-project',  // optional: default project for all traces
  // batchSize: 50,          // optional: flush after N events (default: 50)
  // flushInterval: 2000,    // optional: flush every N ms (default: 2000)
})
```

For **Next.js**, use `src/instrumentation.ts` instead (Next.js 15 auto-runs it on startup):

```typescript
// src/instrumentation.ts
export async function register() {
  const { init } = await import('@trulayer/sdk/node')
  init({ apiKey: process.env.TRULAYER_API_KEY ?? '' })
}
```

### Environment variable

Add to `.env.local` (Next.js) or `.env`:

```
TRULAYER_API_KEY=tl_your_key_here
```

Get an API key from **Dashboard → Settings → API keys**. Use a key scoped to `write` for the backend service that sends traces.

### Install

```bash
npm install @trulayer/sdk
# or
pnpm add @trulayer/sdk
```

## Rules

- Call `init()` exactly once, at application startup, before any traces are created.
- The API key must be a server-side secret — never expose it to the browser.
- For browser/Edge usage, use `@trulayer/sdk/browser` which sends traces through your own backend relay endpoint.
- After init, import and use `tl.trace()` / `tl.span()` anywhere in the codebase.
