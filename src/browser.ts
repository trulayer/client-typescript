/**
 * Browser entry point: `@trulayer/sdk/browser`
 *
 * Relays trace events through a server-side proxy (e.g. a Next.js API route)
 * instead of calling the TruLayer API directly. This avoids CORS issues and
 * keeps the API key out of client-side code.
 *
 * Usage:
 *   import { initBrowser } from '@trulayer/sdk/browser'
 *
 *   const tl = initBrowser({
 *     apiKey: 'unused-but-required-by-type',
 *     projectName: 'my-app',
 *     relayUrl: '/api/trulayer',
 *   })
 */

export { TruLayer } from './client.js'
export { TraceContext, SpanContext } from './trace.js'
export { NoopTraceContext, NoopSpanContext } from './noop.js'
export { instrumentOpenAI } from './instruments/openai.js'
export { instrumentAnthropic } from './instruments/anthropic.js'
export { instrumentVercelAI } from './instruments/vercel-ai.js'
export { TruLayerCallbackHandler } from './instruments/langchain.js'
export type { TruLayerConfig, TraceData, SpanData, FeedbackData, SpanType } from './model.js'

import { TruLayer } from './client.js'
import type { TruLayerConfig } from './model.js'
import { BrowserBatchSender } from './browser-batch.js'

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_FLUSH_INTERVAL = 2000

export type BrowserConfig = TruLayerConfig & { relayUrl: string }

/**
 * Initialize the SDK for browser environments.
 *
 * Requires `relayUrl` — the path to a server-side route that proxies
 * batch payloads to the TruLayer API with the proper auth header.
 *
 * The browser sender:
 * - POSTs to `relayUrl` (not the TruLayer API)
 * - Does NOT include an `Authorization` header
 * - Sets `credentials: 'include'` so session cookies are forwarded
 */
export function initBrowser(config: BrowserConfig): TruLayer {
  if (!config.relayUrl) {
    throw new Error(
      '[trulayer] relayUrl is required in browser mode. ' +
        'Pass the path to your server-side relay (e.g. "/api/trulayer").',
    )
  }

  const sender = new BrowserBatchSender(
    config.relayUrl,
    config.batchSize ?? DEFAULT_BATCH_SIZE,
    config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
  )

  return new TruLayer(config, sender)
}
