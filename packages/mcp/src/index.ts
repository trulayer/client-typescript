import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { loadConfig } from './config.js'
import { TruLayerApiError, formatApiError } from './errors.js'
import { HttpClient } from './http.js'
import { logger } from './logger.js'
import { buildServer } from './server.js'
import { MCP_SERVER_VERSION } from './version.js'

async function verifyApiKey(client: HttpClient): Promise<void> {
  // Cheap sanity call: GET /v1/metrics with a tight timeout.
  // Surfaces auth problems at startup rather than on first tool call.
  try {
    await client.get({ path: '/v1/metrics', timeoutMs: 5_000 })
    logger.info('api_key_verified')
  } catch (err) {
    if (err instanceof TruLayerApiError) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        throw new Error(formatApiError(err))
      }
      // Non-auth failures (network hiccup, 5xx, timeout) are non-fatal —
      // log and let the server start. The first real tool call will
      // surface the underlying issue to the agent.
      logger.warn('api_key_verification_skipped', {
        status_code: err.statusCode,
        reason: err.message,
      })
      return
    }
    throw err
  }
}

export async function main(): Promise<void> {
  const config = loadConfig()
  logger.info('mcp_server_start', {
    version: MCP_SERVER_VERSION,
    base_url: config.baseUrl,
  })

  const client = new HttpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  })

  await verifyApiKey(client)

  const server = buildServer({ client })
  const transport = new StdioServerTransport()
  await server.connect(transport)

  logger.info('mcp_server_ready', { transport: 'stdio' })
}

// Run when executed as a CLI binary.
main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  logger.error('mcp_server_fatal', { error: msg })
  process.stderr.write(`trulayer-mcp: ${msg}\n`)
  process.exit(1)
})
