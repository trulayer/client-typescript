---
description: Wrap an AI provider client with TruLayer instrumentation. Usage: /tl-instrument <provider> — e.g. /tl-instrument openai
---

Add TruLayer auto-instrumentation to an AI provider client in the current project. The argument is: $ARGUMENTS

Parse the argument as: <provider>
- provider: the provider to instrument (openai, anthropic, vercel-ai, langchain, llamaindex)

## What to do

1. Find where the provider client is instantiated in the codebase.
2. Import the TruLayer SDK and wrap the client using the appropriate instrument call.

### OpenAI

```typescript
import { init, instrumentOpenAI } from '@trulayer/sdk'
import OpenAI from 'openai'

const tl = init({ apiKey: process.env.TRULAYER_API_KEY })
const openai = instrumentOpenAI(new OpenAI(), tl)
// Use `openai` exactly as before — all completions are now traced.
```

### Anthropic

```typescript
import { init, instrumentAnthropic } from '@trulayer/sdk'
import Anthropic from '@anthropic-ai/sdk'

const tl = init({ apiKey: process.env.TRULAYER_API_KEY })
const anthropic = instrumentAnthropic(new Anthropic(), tl)
```

### Vercel AI SDK

```typescript
import { init, truLayerMiddleware } from '@trulayer/sdk'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const tl = init({ apiKey: process.env.TRULAYER_API_KEY })
const result = await generateText({
  model: openai('gpt-4o'),
  middleware: truLayerMiddleware(tl),
  prompt: 'Hello',
})
```

## Rules

- Never modify the original client — only wrap it.
- The `TRULAYER_API_KEY` env var must be set. Add it to `.env.local` or your deployment secrets.
- The wrapped client is type-identical to the original — no type changes needed in call sites.
- Add `@trulayer/sdk` to `package.json` dependencies if not already present: `npm install @trulayer/sdk`

After instrumenting, verify traces appear in the TruLayer dashboard under the project linked to your API key.
