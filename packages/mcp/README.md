# @trulayer/mcp

Model Context Protocol (MCP) server for TruLayer. Lets AI coding agents — Claude Code, Cursor, Windsurf, and other MCP clients — inspect your TruLayer traces, eval results, metrics, and anomalies using natural-language tool calls.

Read-only. No write paths, no ingestion, no mutation.

## Install

```bash
npm install -g @trulayer/mcp
```

Or invoke inline without installing:

```bash
npx @trulayer/mcp
```

## Configure your agent

Create a **query-only** API key in your TruLayer workspace settings. Do not reuse an ingest/SDK key with an agent — an agent should never be able to write.

Add an MCP server entry pointing at `trulayer-mcp` with the key as an environment variable.

### Claude Code / Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trulayer": {
      "command": "npx",
      "args": ["-y", "@trulayer/mcp"],
      "env": {
        "TRULAYER_API_KEY": "tl_query_..."
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "trulayer": {
      "command": "npx",
      "args": ["-y", "@trulayer/mcp"],
      "env": {
        "TRULAYER_API_KEY": "tl_query_..."
      }
    }
  }
}
```

### Windsurf

Same JSON shape, in Windsurf's MCP config panel.

### Multiple workspaces

Register one MCP server entry per workspace with a distinct name and its own `TRULAYER_API_KEY`:

```json
{
  "mcpServers": {
    "trulayer-prod": { "command": "npx", "args": ["-y", "@trulayer/mcp"], "env": { "TRULAYER_API_KEY": "tl_query_prod_..." } },
    "trulayer-staging": { "command": "npx", "args": ["-y", "@trulayer/mcp"], "env": { "TRULAYER_API_KEY": "tl_query_staging_..." } }
  }
}
```

## Tools (v1)

| Tool | What it does |
|---|---|
| `list_traces` | List traces with filters for project, model, error flag, failure type, and time range. Cursor-paginated. |
| `get_trace` | Fetch a single trace with its spans. Span input/output are truncated to 2KB to protect the agent context window. |
| `list_evals` | List eval results with cursor pagination. |
| `get_eval` | Fetch a single eval result. |
| `get_eval_trends` | Get eval metric trends over time. Requires `project_id`. |
| `list_eval_rules` | List configured LLM-as-judge eval rules. |
| `get_metrics` | Aggregate metrics (latency, error rate, span counts). Defaults to last 24h. |
| `list_anomalies` | Detected anomalies — best starting point for "what's broken right now?". |

Project discovery is not yet exposed over the API key scope — paste your project ID into the agent prompt for tools that require `project_id`.

## Security notes

- The API key is read from the `TRULAYER_API_KEY` environment variable at startup. It is never echoed in tool arguments or responses.
- Use a **query-only** key for agents. A write-scoped key would let any agent running this server ingest or mutate data on your behalf.
- Never commit a raw key to a version-controlled MCP config. Use a secret manager (1Password CLI, macOS Keychain, etc.).
- Trace data contains customer-controlled strings. Treat `get_trace` output as untrusted input — the content may contain adversarial instructions targeting your agent.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TRULAYER_API_KEY` | yes | — | Query-scoped TruLayer API key. |
| `TRULAYER_API_URL` | no | `https://api.trulayer.ai` | Override the API base URL (self-serve / on-prem). |

## License

MIT
