import type { TraceContext } from '../trace.js'

/**
 * Auto-instrumentation for LlamaIndex.TS (`llamaindex` npm package).
 *
 * Wraps `QueryEngine.query()` (synthesis) and `BaseRetriever.retrieve()`
 * (retrieval) calls. Structural typing — no runtime dependency on the
 * `llamaindex` package.
 *
 * Emits OTel GenAI semconv attributes as span metadata:
 *   - `gen_ai.system` = "llamaindex"
 *   - `gen_ai.request.model` on synthesis spans when the query engine exposes
 *     an LLM with a model id
 *   - retrieval spans include `retrieval.document_count`
 *
 * Never throws into user code — instrumentation errors are caught, warned to
 * the console, and the original return value is surfaced unchanged.
 */

type QueryEngineLike = {
  query?: (...args: unknown[]) => unknown
  llm?: { metadata?: { model?: string }; model?: string }
  retriever?: RetrieverLike
}

type RetrieverLike = {
  retrieve?: (...args: unknown[]) => unknown
}

type QueryParams = string | { query?: string; [key: string]: unknown }

type QueryResponse = {
  response?: string
  message?: { content?: string }
  sourceNodes?: unknown[]
  usage?: {
    promptTokens?: number
    completionTokens?: number
    inputTokens?: number
    outputTokens?: number
  }
  [key: string]: unknown
}

type RetrieveResponse = unknown[] | { nodes?: unknown[] }

function safeWarn(message: string, err: unknown): void {
  try {
    console.warn(`[trulayer] ${message}`, err)
  } catch {
    /* never throw */
  }
}

function extractQueryString(params: QueryParams | undefined): string {
  if (typeof params === 'string') return params
  if (params && typeof params === 'object' && typeof params.query === 'string') return params.query
  return ''
}

function extractQueryEngineModel(engine: QueryEngineLike): string | null {
  if (!engine.llm) return null
  if (typeof engine.llm.metadata?.model === 'string') return engine.llm.metadata.model
  if (typeof engine.llm.model === 'string') return engine.llm.model
  return null
}

function extractResponseText(result: QueryResponse | string | undefined): string {
  if (typeof result === 'string') return result
  if (!result) return ''
  if (typeof result.response === 'string') return result.response
  if (result.message && typeof result.message.content === 'string') return result.message.content
  try {
    return JSON.stringify(result)
  } catch {
    return ''
  }
}

function extractDocumentCount(result: RetrieveResponse | undefined): number {
  if (!result) return 0
  if (Array.isArray(result)) return result.length
  if (Array.isArray(result.nodes)) return result.nodes.length
  return 0
}

/**
 * Returns a new instrumented LlamaIndex query engine. The `.query()` call is
 * wrapped in an `llm` span; the nested retriever (if any) is also wrapped.
 * The original engine is not mutated.
 */
export function instrumentLlamaIndexQueryEngine<T extends QueryEngineLike>(
  engine: T,
  trace: TraceContext,
): T {
  return new Proxy(engine, {
    get(target, prop, receiver) {
      if (prop === 'retriever' && target.retriever) {
        return instrumentLlamaIndexRetriever(target.retriever, trace)
      }

      const value = Reflect.get(target, prop, receiver)

      if (prop === 'query' && typeof value === 'function') {
        return function instrumentedQuery(...args: [QueryParams, ...unknown[]]) {
          const params = args[0]
          return (async () => {
            return trace.span('llamaindex.query', 'llm', async (span) => {
              try {
                span.setInput(extractQueryString(params))
                const model = extractQueryEngineModel(target)
                if (model) span.setModel(model)
                span.setMetadata({
                  'gen_ai.system': 'llamaindex',
                  ...(model ? { 'gen_ai.request.model': model } : {}),
                })
              } catch (err) {
                safeWarn('llamaindex query span setup failed', err)
              }

              const result = (await (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              )) as QueryResponse | string

              try {
                span.setOutput(extractResponseText(result))
                if (result && typeof result === 'object') {
                  if (Array.isArray(result.sourceNodes)) {
                    span.setMetadata({
                      'retrieval.document_count': result.sourceNodes.length,
                    })
                  }
                  if (result.usage) {
                    const input = result.usage.inputTokens ?? result.usage.promptTokens
                    const output = result.usage.outputTokens ?? result.usage.completionTokens
                    span.setTokens(input, output)
                    span.setMetadata({
                      ...(input !== undefined ? { 'gen_ai.usage.input_tokens': input } : {}),
                      ...(output !== undefined
                        ? { 'gen_ai.usage.output_tokens': output }
                        : {}),
                    })
                  }
                }
              } catch (err) {
                safeWarn('llamaindex query span teardown failed', err)
              }

              return result
            })
          })()
        }
      }

      return value
    },
  }) as T
}

/**
 * Returns a new instrumented LlamaIndex retriever. The `.retrieve()` call is
 * wrapped in a `retrieval` span with the document count recorded as
 * metadata. The original retriever is not mutated.
 */
export function instrumentLlamaIndexRetriever<T extends RetrieverLike>(
  retriever: T,
  trace: TraceContext,
): T {
  return new Proxy(retriever, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (prop === 'retrieve' && typeof value === 'function') {
        return function instrumentedRetrieve(...args: [QueryParams, ...unknown[]]) {
          const params = args[0]
          return (async () => {
            return trace.span('llamaindex.retrieve', 'retrieval', async (span) => {
              try {
                span.setInput(extractQueryString(params))
                span.setMetadata({ 'gen_ai.system': 'llamaindex' })
              } catch (err) {
                safeWarn('llamaindex retrieve span setup failed', err)
              }

              const result = (await (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              )) as RetrieveResponse

              try {
                const count = extractDocumentCount(result)
                span.setMetadata({ 'retrieval.document_count': count })
                span.setOutput(JSON.stringify({ document_count: count }))
              } catch (err) {
                safeWarn('llamaindex retrieve span teardown failed', err)
              }

              return result
            })
          })()
        }
      }

      return value
    },
  }) as T
}
