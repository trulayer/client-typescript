---
description: Add a TypeScript type/interface to src/model.ts. Usage: /type <name> — e.g. /type TraceData
---

Add a typed interface or type alias to `src/model.ts`. The argument is: $ARGUMENTS

Parse the argument as: <name>
- name: PascalCase type name (e.g. TraceData, SpanInput, EvalResult)

Read `src/model.ts` first to understand existing types and naming conventions.

Generate following these rules:
- Use `interface` for object shapes, `type` for unions/aliases
- All IDs are `string` (UUIDv7 as string)
- All timestamps are `string` (ISO 8601 — JSON serialized)
- Optional fields use `field?: Type` (not `field: Type | undefined`)
- Field names must match Go backend JSON tags exactly (snake_case)
- No `any` — use `unknown` for open-ended metadata fields

Example shape:
```typescript
export interface <name> {
  id: string
  tenant_id: string
  // TODO: domain fields
  created_at: string
}

// Input type for creating (omit server-set fields):
export type <name>Input = Omit<<name>, 'id' | 'created_at'>
```

After generating:
1. Export the new type from `src/index.ts` if it's part of the public API.
2. Cross-check field names against the Go backend's JSON tags in `backend/internal/model/`.
3. Run `pnpm type-check` to verify no type errors.
