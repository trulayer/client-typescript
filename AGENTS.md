# Codex instructions

This is the public TruLayer TypeScript SDK repo. `CLAUDE.md` is the detailed source of truth; read it before making any non-trivial change.

## Scope

- `@trulayer/sdk` for Node, Edge runtimes, Bun, browser relay mode, testing helpers, redaction, replay, and provider/framework instrumentation.
- Public customer-facing repo. Do not expose private service names, repo paths, planning issues, or private architecture.

## Working rules

- Make changes on a feature/fix branch and open a PR to `main`. Never commit directly to `main`.
- Keep the core SDK Edge-compatible. Avoid Node-only globals/imports outside Node-specific entry points.
- Prefer named exports. Do not add default exports.
- Keep runtime dependencies minimal and intentional.
- Keep public exports documented when they change.

## Verification

Run before opening a PR:

```bash
pnpm type-check
pnpm test
pnpm lint
pnpm build
```
