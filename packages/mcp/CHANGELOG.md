# Changelog

All notable changes to `@trulayer/mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — 2026-04-26

Initial public release of the TruLayer MCP server.

### Added

- Model Context Protocol server exposing read-only access to TruLayer traces,
  eval results, metrics, and anomalies for AI coding agents (Claude Code,
  Claude Desktop, Cursor, Windsurf, and other MCP clients).
- `trulayer-mcp` CLI entry point published as a Node.js binary; usable via
  `npx @trulayer/mcp` or a global install.
- Eight read-only tools registered against the MCP server covering trace
  lookup, eval inspection, metrics, and anomaly retrieval.
- Pinned `@modelcontextprotocol/sdk` at exact version `1.29.0` for
  reproducible builds.
- Node.js 18+ runtime support.

### Security

- Read-only by design — no write, ingest, or mutation paths exposed.
  Designed to be paired with a query-only TruLayer API key.
