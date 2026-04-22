import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { formatApiError, TruLayerApiError } from './errors.js'
import { HttpClient } from './http.js'
import { logger } from './logger.js'
import { ALL_TOOLS, toolByName } from './tools.js'
import { MCP_SERVER_VERSION } from './version.js'

export interface BuildServerOptions {
  client: HttpClient
}

/**
 * Build the MCP server and wire handlers for `tools/list` and `tools/call`.
 * Tool calls are proxied to the TruLayer API via the injected HttpClient.
 */
export function buildServer(opts: BuildServerOptions): Server {
  const server = new Server(
    {
      name: '@trulayer/mcp',
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params
    const tool = toolByName(name)
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${name}` }],
      }
    }

    const args = (rawArgs ?? {}) as Record<string, unknown>
    const started = Date.now()
    let statusCode = 200

    try {
      const result = await tool.handler(args, opts.client)
      const latencyMs = Date.now() - started
      logger.info('tool_call', { tool: name, latency_ms: latencyMs, status_code: statusCode })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result ?? {}, null, 2),
          },
        ],
      }
    } catch (err) {
      const latencyMs = Date.now() - started
      if (err instanceof TruLayerApiError) {
        statusCode = err.statusCode
        logger.warn('tool_call_error', {
          tool: name,
          latency_ms: latencyMs,
          status_code: statusCode,
        })
        return {
          isError: true,
          content: [{ type: 'text', text: formatApiError(err) }],
        }
      }
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('tool_call_exception', {
        tool: name,
        latency_ms: latencyMs,
        status_code: 0,
        error: msg,
      })
      return {
        isError: true,
        content: [{ type: 'text', text: `tool failed: ${msg}` }],
      }
    }
  })

  return server
}
