import type { TraceContext, SpanContext } from '../trace.js'

/**
 * A LangChain.js callback handler that auto-creates spans for chain steps.
 *
 * Works via structural typing — no runtime dependency on `@langchain/core`.
 * LangChain accepts any object with the right method signatures as a callback handler.
 *
 * Usage:
 *   const handler = new TruLayerCallbackHandler(trace)
 *   await chain.invoke({ input }, { callbacks: [handler] })
 */
export class TruLayerCallbackHandler {
  readonly name = 'TruLayerCallbackHandler'

  private readonly trace: TraceContext
  private readonly spans = new Map<string, { span: SpanContext; resolve: () => void }>()

  constructor(trace: TraceContext) {
    this.trace = trace
  }

  handleLLMStart(
    llm: { name?: string; id?: string[] },
    prompts: string[],
    runId: string,
  ): void {
    const name = llm.name ?? 'llm'
    const input = prompts.join('\n')
    // Start a span — we resolve it when handleLLMEnd/handleLLMError fires.
    void this.openSpan(runId, name, 'llm', input)
  }

  handleLLMEnd(
    output: { generations?: Array<Array<{ text?: string }>>; llmOutput?: Record<string, unknown> },
    runId: string,
  ): void {
    const text =
      output.generations?.[0]?.[0]?.text ?? ''
    this.closeSpan(runId, text)
  }

  handleLLMError(error: Error, runId: string): void {
    this.closeSpan(runId, undefined, error)
  }

  handleChainStart(
    chain: { name?: string; id?: string[] },
    inputs: Record<string, unknown>,
    runId: string,
  ): void {
    const name = chain.name ?? 'chain'
    const input = JSON.stringify(inputs)
    void this.openSpan(runId, name, 'other', input)
  }

  handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
  ): void {
    const output = JSON.stringify(outputs)
    this.closeSpan(runId, output)
  }

  handleChainError(error: Error, runId: string): void {
    this.closeSpan(runId, undefined, error)
  }

  handleToolStart(
    tool: { name?: string; id?: string[] },
    input: string,
    runId: string,
  ): void {
    const name = tool.name ?? 'tool'
    void this.openSpan(runId, name, 'tool', input)
  }

  handleToolEnd(output: string, runId: string): void {
    this.closeSpan(runId, output)
  }

  handleToolError(error: Error, runId: string): void {
    this.closeSpan(runId, undefined, error)
  }

  private async openSpan(
    runId: string,
    name: string,
    spanType: 'llm' | 'tool' | 'other',
    input: string,
  ): Promise<void> {
    // We use an unresolved promise pattern: trace.span callback stays open
    // until we resolve it in closeSpan.
    let resolveHolder: (() => void) | undefined
    const done = new Promise<void>((r) => {
      resolveHolder = r
    })

    // Fire-and-forget the span. The promise resolves when closeSpan is called.
    void this.trace
      .span(name, spanType, async (span) => {
        span.setInput(input)
        this.spans.set(runId, { span, resolve: resolveHolder! })
        await done
      })
      .catch(() => {
        // Span error propagation is handled inside closeSpan
      })
  }

  private closeSpan(runId: string, output?: string, error?: Error): void {
    const entry = this.spans.get(runId)
    if (!entry) return
    this.spans.delete(runId)

    if (output !== undefined) {
      entry.span.setOutput(output)
    }
    if (error) {
      entry.span.data.error = error.message
    }
    entry.resolve()
  }
}
