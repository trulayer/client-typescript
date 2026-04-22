/**
 * Structured stderr logger.
 *
 * MCP stdio servers MUST NOT write to stdout — that channel carries the
 * JSON-RPC protocol. All logs go to stderr as newline-delimited JSON.
 *
 * Tool arguments and response payloads are never logged — only tool name,
 * latency, and HTTP status code.
 */

type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  }
  try {
    process.stderr.write(JSON.stringify(record) + '\n')
  } catch {
    // Swallow logging failures — never crash the server on a log write.
  }
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}
