export { TruLayer } from './client.js'
export { TraceContext, SpanContext } from './trace.js'
export { NoopTraceContext, NoopSpanContext } from './noop.js'
export { instrumentOpenAI } from './instruments/openai.js'
export { instrumentAnthropic } from './instruments/anthropic.js'
export { instrumentVercelAI } from './instruments/vercel-ai.js'
export { TruLayerCallbackHandler } from './instruments/langchain.js'
export type { TruLayerConfig, TraceData, SpanData, FeedbackData, SpanType, BatchSenderLike } from './model.js'
export { createTestClient, assertSender, SenderAssertions } from './testing.js'
export { LocalBatchSender } from './local-batch.js'
export type { CapturedBatch } from './local-batch.js'

import { TruLayer } from './client.js'
import type { TruLayerConfig } from './model.js'

let _globalClient: TruLayer | null = null

export function init(config: TruLayerConfig): TruLayer {
  _globalClient = new TruLayer(config)
  return _globalClient
}

export function getClient(): TruLayer {
  if (_globalClient === null) throw new Error('[trulayer] call init() before getClient()')
  return _globalClient
}
