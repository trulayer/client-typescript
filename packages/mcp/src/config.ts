export interface ResolvedConfig {
  baseUrl: string
  apiKey: string
}

export const DEFAULT_BASE_URL = 'https://api.trulayer.ai'

/**
 * Read configuration from environment variables. Fails loudly if the
 * API key is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const apiKey = env.TRULAYER_API_KEY
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'TRULAYER_API_KEY is not set. Create a query-only API key in your TruLayer ' +
        'workspace settings and add it to the MCP server config as the ' +
        'TRULAYER_API_KEY environment variable.',
    )
  }
  const baseUrl = (env.TRULAYER_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}
