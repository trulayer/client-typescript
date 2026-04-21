import type { TruLayerConfig } from './model.js'
import { TruLayer } from './client.js'
import { LocalBatchSender } from './local-batch.js'

/**
 * Create a TruLayer client wired to an in-memory LocalBatchSender.
 * No API key required. Use `.sender.traces` / `.sender.spans` to assert.
 *
 * @example
 * const { client, sender } = createTestClient()
 * const trace = client.trace('my-test', async (t) => {
 *   await t.span('step-1', 'default', async () => {})
 * })
 * await client.shutdown()
 * expect(sender.spans).toHaveLength(1)
 */
export function createTestClient(config?: Partial<TruLayerConfig>): {
  client: TruLayer
  sender: LocalBatchSender
} {
  const sender = new LocalBatchSender()
  const client = new TruLayer(
    { apiKey: 'test-key', projectName: 'test', ...config },
    sender,
  )
  return { client, sender }
}

/**
 * Fluent assertions on a LocalBatchSender. Throws if assertion fails.
 *
 * @example
 * assertSender(sender).hasTrace().spanCount(3).hasSpanNamed('llm-call')
 */
export class SenderAssertions {
  constructor(private sender: LocalBatchSender) {}

  hasTrace(traceId?: string): this {
    if (traceId) {
      const found = this.sender.traces.some((t) => t.id === traceId)
      if (!found) throw new Error(`Expected trace ${traceId} not found`)
    } else if (this.sender.traces.length === 0) {
      throw new Error('Expected at least one trace, found none')
    }
    return this
  }

  spanCount(n: number): this {
    if (this.sender.spans.length !== n) {
      throw new Error(`Expected ${n} spans, got ${this.sender.spans.length}`)
    }
    return this
  }

  hasSpanNamed(name: string): this {
    const found = this.sender.spans.some((s) => s.name === name)
    if (!found) throw new Error(`Expected span named "${name}" not found`)
    return this
  }
}

export function assertSender(sender: LocalBatchSender): SenderAssertions {
  return new SenderAssertions(sender)
}

export { LocalBatchSender } from './local-batch.js'
export type { CapturedBatch } from './local-batch.js'
