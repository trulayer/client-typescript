// End-to-end integration test for the TruLayer MCP server.
//
// Spawns the compiled MCP server as a subprocess and drives it over stdio
// JSON-RPC — exercising the real MCP protocol handshake and every tool call.
//
// This test is opt-in: it only runs when both TRULAYER_API_KEY and
// TRULAYER_API_URL are set in the environment. In CI these are unset, so the
// entire suite skips. It's intended for local smoke testing and pre-release
// validation against a live TruLayer API.
//
// Prerequisites (local): `pnpm --filter @trulayer/mcp build` must have
// produced `packages/mcp/dist/index.js` before running.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const apiKey = process.env.TRULAYER_API_KEY
const apiUrl = process.env.TRULAYER_API_URL

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverEntry = resolve(__dirname, '../dist/index.js')

const EXPECTED_TOOLS = [
  'list_traces',
  'get_trace',
  'list_evals',
  'get_eval',
  'get_eval_trends',
  'list_eval_rules',
  'get_metrics',
  'list_anomalies',
] as const

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

describe.skipIf(!apiKey || !apiUrl)('MCP E2E core flow', () => {
  let server: ChildProcessWithoutNullStreams
  let rl: ReadlineInterface
  const responses = new Map<number, JsonRpcResponse>()
  const waiters = new Map<number, (res: JsonRpcResponse) => void>()
  let nextId = 1

  const sendMessage = (msg: Record<string, unknown>): void => {
    server.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  const waitForResponse = (id: number, timeoutMs = 15_000): Promise<JsonRpcResponse> => {
    const already = responses.get(id)
    if (already) {
      responses.delete(id)
      return Promise.resolve(already)
    }
    return new Promise<JsonRpcResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        waiters.delete(id)
        rejectPromise(new Error(`timeout waiting for JSON-RPC response id=${id}`))
      }, timeoutMs)
      waiters.set(id, (res) => {
        clearTimeout(timer)
        resolvePromise(res)
      })
    })
  }

  const rpc = async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const id = nextId++
    sendMessage({ jsonrpc: '2.0', id, method, params: params ?? {} })
    return waitForResponse(id)
  }

  const callTool = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolCallResult> => {
    const res = await rpc('tools/call', { name, arguments: args })
    if (res.error) {
      throw new Error(`tool ${name} failed: ${res.error.message}`)
    }
    return res.result as ToolCallResult
  }

  beforeAll(async () => {
    if (!existsSync(serverEntry)) {
      throw new Error(
        `MCP server build not found at ${serverEntry}. Run \`pnpm --filter @trulayer/mcp build\` first.`,
      )
    }

    server = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        TRULAYER_API_KEY: apiKey,
        TRULAYER_API_URL: apiUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams

    // Surface server stderr to the test log but don't fail on it — the server
    // writes structured JSON logs to stderr during normal operation.
    server.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[mcp-server] ${chunk.toString()}`)
    })

    rl = createInterface({ input: server.stdout })
    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let msg: JsonRpcResponse
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse
      } catch {
        // Non-JSON stdout (unexpected — but don't crash the test).
        process.stderr.write(`[mcp-server stdout non-json] ${trimmed}\n`)
        return
      }
      if (typeof msg.id !== 'number') return
      const waiter = waiters.get(msg.id)
      if (waiter) {
        waiters.delete(msg.id)
        waiter(msg)
      } else {
        responses.set(msg.id, msg)
      }
    })

    // MCP initialize handshake.
    const init = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'trulayer-mcp-e2e', version: '0.0.0' },
    })
    if (init.error) {
      throw new Error(`initialize failed: ${init.error.message}`)
    }
    sendMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }, 30_000)

  afterAll(() => {
    rl?.close()
    if (server && !server.killed) {
      server.kill('SIGTERM')
    }
  })

  it('initializes the server', async () => {
    // Re-run initialize to assert serverInfo shape. The MCP SDK accepts a
    // second initialize on the same connection and echoes the server info.
    const res = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'trulayer-mcp-e2e', version: '0.0.0' },
    })
    expect(res.error).toBeUndefined()
    const result = res.result as {
      serverInfo?: { name?: string; version?: string }
    }
    expect(result.serverInfo?.name).toBe('@trulayer/mcp')
    expect(result.serverInfo?.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('lists exactly 8 tools', async () => {
    const res = await rpc('tools/list')
    expect(res.error).toBeUndefined()
    const result = res.result as { tools: Array<{ name: string }> }
    const names = result.tools.map((t) => t.name).sort()
    expect(names).toHaveLength(EXPECTED_TOOLS.length)
    expect(names).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('list_traces returns valid response', async () => {
    const result = await callTool('list_traces', { limit: 5 })
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThanOrEqual(1)
    const first = result.content[0]
    expect(first.type).toBe('text')
    const parsed = JSON.parse(first.text) as Record<string, unknown>
    expect(parsed).toHaveProperty('traces')
    expect(Array.isArray(parsed.traces)).toBe(true)
  })

  it('get_metrics returns valid response', async () => {
    const result = await callTool('get_metrics', {})
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.type).toBe('text')
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>
    // The metrics response shape exposes aggregate counters; assert at least
    // one of the documented keys is present rather than pinning the exact set.
    const metricKeys = ['total_traces', 'total_spans', 'error_rate', 'p95_latency_ms', 'total_cost_usd']
    const hasAny = metricKeys.some((k) => k in parsed)
    expect(hasAny).toBe(true)
  })

  it('list_anomalies returns valid response', async () => {
    const result = await callTool('list_anomalies', {})
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.type).toBe('text')
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>
    expect(parsed).toHaveProperty('anomalies')
    expect(Array.isArray(parsed.anomalies)).toBe(true)
  })

  it('list_eval_rules returns a valid response or surfaces the known auth gap', async () => {
    // Documents the current API-key scope gap for list_eval_rules. Once the
    // backend fix (tracked as TRU-258) ships, this test should always return
    // a valid body — until then a 401 is recorded as a known gap rather
    // than a hard failure.
    const result = await callTool('list_eval_rules', {})
    const text = result.content[0]?.text ?? ''
    if (result.isError && /401|unauthori[sz]ed/i.test(text)) {
      console.warn(
        '[mcp-e2e] list_eval_rules returned 401 — known gap pending backend fix (TRU-258).',
      )
      return
    }
    expect(result.isError).not.toBe(true)
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed).toHaveProperty('eval_rules')
    expect(Array.isArray(parsed.eval_rules)).toBe(true)
  })
})
