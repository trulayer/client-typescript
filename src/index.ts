export { TruLayer } from './client.js'
export { TraceContext, SpanContext } from './trace.js'
export { NoopTraceContext, NoopSpanContext } from './noop.js'
export { instrumentOpenAI } from './instruments/openai.js'
export { instrumentAnthropic } from './instruments/anthropic.js'
export { instrumentVercelAI } from './instruments/vercel-ai.js'
export { instrumentVercelAITools } from './instruments/vercel-ai-tool-calls.js'
export {
  instrumentMastraAgent,
  instrumentMastraWorkflow,
} from './instruments/mastra.js'
export {
  instrumentLlamaIndexQueryEngine,
  instrumentLlamaIndexRetriever,
} from './instruments/llamaindex.js'
export { TruLayerCallbackHandler } from './instruments/langchain.js'
export type {
  TruLayerConfig,
  TraceData,
  SpanData,
  TraceWire,
  SpanWire,
  FeedbackData,
  SpanType,
  BatchSenderLike,
  EvalRequest,
  EvalTriggerResponse,
} from './model.js'
export { traceToWire, spanToWire } from './model.js'
export {
  createTestClient,
  assertSender,
  SenderAssertions,
  TraceAssertions,
} from './testing.js'
export { LocalBatchSender } from './local-batch.js'
export type { CapturedBatch } from './local-batch.js'
export { Redactor, BUILTIN_PACKS, redact } from './redact.js'
export type { Rule, RedactorOptions, PackName } from './redact.js'
export { InvalidAPIKeyError, TruLayerFlushError } from './errors.js'
export { replay } from './replay.js'
export type { ReplayOptions, ReplayResult } from './replay.js'

import { TruLayer } from './client.js'
import type { TruLayerConfig } from './model.js'
import { LocalBatchSender } from './local-batch.js'
import { replay } from './replay.js'

let _globalClient: TruLayer | null = null

export function init(config: TruLayerConfig): TruLayer {
  _globalClient = new TruLayer(config)

  // TRULAYER_MODE=replay: fire-and-forget replay of a JSONL capture file
  // into the client's in-memory sender so test harnesses can load a
  // golden trace on process start. The client must be running in LOCAL
  // mode for replay to have an observable effect — otherwise replayed
  // traces would be shipped to the live API.
  if (
    typeof process !== 'undefined' &&
    process.env['TRULAYER_MODE'] === 'replay'
  ) {
    const file = process.env['TRULAYER_REPLAY_FILE']
    if (!file) {
      console.warn(
        '[trulayer] TRULAYER_MODE=replay requires TRULAYER_REPLAY_FILE to be set',
      )
    } else if (_globalClient._batch instanceof LocalBatchSender) {
      void replay({ file, sender: _globalClient._batch }).catch((err: unknown) => {
        console.warn('[trulayer] replay failed:', err)
      })
    } else {
      console.warn(
        '[trulayer] TRULAYER_MODE=replay is only honored when the client is ' +
          'using LocalBatchSender (set TRULAYER_MODE=local as well)',
      )
    }
  }

  return _globalClient
}

export function getClient(): TruLayer {
  if (_globalClient === null) throw new Error('[trulayer] call init() before getClient()')
  return _globalClient
}
