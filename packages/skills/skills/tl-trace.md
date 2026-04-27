---
description: Wrap a function or async block with a TruLayer trace. Usage: /tl-trace <function-name> — e.g. /tl-trace processDocument
---

Add a TruLayer trace around an existing function or code block. The argument is: $ARGUMENTS

Parse the argument as: <function-name>
- function-name: the name of the function or operation to trace (e.g. processDocument, runEval, scoreResponse)

## What to do

1. Find the function named `<function-name>` in the codebase.
2. Wrap its body with a `tl.trace()` call, passing a meaningful name and any relevant input metadata.

### Pattern — async function

```typescript
import { getTruLayer } from '@trulayer/sdk'

async function <function-name>(input: string): Promise<string> {
  const tl = getTruLayer()
  return tl.trace(
    {
      name: '<function-name>',
      project: 'my-project',        // optional: scopes the trace to a project
      input: JSON.stringify(input),  // optional: log the input
    },
    async (trace) => {
      // Original function body goes here.
      // Add child spans with trace.span() for sub-operations.
      const result = await doSomething(input)
      trace.output(JSON.stringify(result)) // optional: log the output
      return result
    },
  )
}
```

### Pattern — named span inside an existing trace

```typescript
async function <function-name>(trace: Trace): Promise<void> {
  await trace.span(
    { name: '<function-name>', input: '...' },
    async (span) => {
      // sub-operation body
      span.output('...')
    },
  )
}
```

## Rules

- `getTruLayer()` returns the globally initialised TruLayer client. Call `init({ apiKey })` once at startup before using it.
- The trace callback must be `async` if any awaited calls are inside.
- `input` and `output` are optional strings — use `JSON.stringify()` for structured data.
- Never throw from inside the callback just to set output — let errors propagate naturally; TruLayer records them automatically.
- Keep the trace name short and stable (no dynamic IDs) — it is used for grouping in the dashboard.
- Add `@trulayer/sdk` to `package.json` if not already present: `npm install @trulayer/sdk`
