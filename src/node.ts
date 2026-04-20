/**
 * Node.js-specific entry point.
 * Adds process lifecycle hooks for graceful shutdown.
 */
import { TruLayer } from './client.js'
import type { TruLayerConfig } from './model.js'

export function init(config: TruLayerConfig): TruLayer {
  const client = new TruLayer(config)

  process.once('beforeExit', () => {
    void client.shutdown()
  })

  process.once('SIGTERM', () => {
    void client.shutdown().then(() => process.exit(0))
  })

  return client
}

export { TruLayer } from './client.js'
export { TraceContext, SpanContext } from './trace.js'
export { instrumentOpenAI } from './instruments/openai.js'
export { instrumentAnthropic } from './instruments/anthropic.js'
export type { TruLayerConfig, TraceData, SpanData, FeedbackData, SpanType } from './model.js'
