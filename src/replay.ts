import type { TraceData } from './model.js'
import { LocalBatchSender } from './local-batch.js'

export interface ReplayOptions {
  /** Absolute or relative path to a JSONL file written by
   * {@link LocalBatchSender.flushToFile}. */
  file: string
  /**
   * Destination sender. When omitted a fresh {@link LocalBatchSender} is
   * created and returned, so tests can inspect the replayed traces
   * directly.
   */
  sender?: LocalBatchSender
}

export interface ReplayResult {
  /** The sender the traces were re-emitted through. */
  sender: LocalBatchSender
  /** Number of traces successfully replayed. */
  replayed: number
  /** Number of malformed JSONL lines that were skipped. */
  skipped: number
}

/**
 * Read a JSONL file of captured traces and re-emit each one through a
 * {@link LocalBatchSender}. Intended for golden-file regression tests and
 * reproducing production traces locally.
 *
 * Follows the SDK's never-throws contract for bad input: malformed lines
 * are logged via `console.warn` and skipped, not surfaced as exceptions.
 * File-system errors (missing file, permission denied) do propagate, since
 * they indicate caller misuse rather than data corruption.
 */
export async function replay(options: ReplayOptions): Promise<ReplayResult> {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(options.file, 'utf8')
  const sender = options.sender ?? new LocalBatchSender()

  let replayed = 0
  let skipped = 0

  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      console.warn(
        `[trulayer:replay] skipping malformed JSON on line ${i + 1}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      skipped++
      continue
    }
    if (!isTraceData(parsed)) {
      console.warn(
        `[trulayer:replay] skipping line ${i + 1}: payload is not a TraceData object`,
      )
      skipped++
      continue
    }
    sender.enqueue(parsed)
    replayed++
  }

  return { sender, replayed, skipped }
}

function isTraceData(value: unknown): value is TraceData {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v['id'] === 'string' &&
    typeof v['project_id'] === 'string' &&
    Array.isArray(v['spans'])
  )
}
