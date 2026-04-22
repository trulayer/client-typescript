import { describe, expect, it, vi } from 'vitest'

import { HttpClient } from '../src/http.js'
import { buildServer } from '../src/server.js'
import { ALL_TOOLS } from '../src/tools.js'

/**
 * Integration-style smoke test: wire a real MCP Server instance against
 * an in-memory linked transport pair and drive it from an MCP Client.
 * Verifies the tools/list and tools/call handlers are correctly
 * registered and respond with the expected shape.
 */
describe('MCP server integration (in-memory transport)', () => {
  it('responds to list_tools with the 8 registered tools', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import(
      '@modelcontextprotocol/sdk/inMemory.js'
    )

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch

    const httpClient = new HttpClient({
      baseUrl: 'https://api.trulayer.ai',
      apiKey: 'test',
      fetchImpl,
    })
    const server = buildServer({ client: httpClient })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} })

    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

    const res = await mcpClient.listTools()
    const names = res.tools.map((t) => t.name).sort()
    expect(names).toEqual(ALL_TOOLS.map((t) => t.name).sort())

    await mcpClient.close()
    await server.close()
  })

  it('routes a tools/call request to the matching handler', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import(
      '@modelcontextprotocol/sdk/inMemory.js'
    )

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      expect(url.pathname).toBe('/v1/metrics')
      return new Response(JSON.stringify({ latency_ms: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const httpClient = new HttpClient({
      baseUrl: 'https://api.trulayer.ai',
      apiKey: 'test',
      fetchImpl,
    })
    const server = buildServer({ client: httpClient })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} })

    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

    const result = await mcpClient.callTool({ name: 'get_metrics', arguments: {} })
    expect(result.isError).toBeFalsy()
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]!.type).toBe('text')
    const parsed = JSON.parse(content[0]!.text)
    expect(parsed.latency_ms).toBe(42)

    await mcpClient.close()
    await server.close()
  })

  it('returns an error content block on unknown tool', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import(
      '@modelcontextprotocol/sdk/inMemory.js'
    )

    const httpClient = new HttpClient({
      baseUrl: 'https://api.trulayer.ai',
      apiKey: 'test',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    const server = buildServer({ client: httpClient })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

    const result = await mcpClient.callTool({ name: 'does_not_exist', arguments: {} })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ text: string }>
    expect(content[0]!.text).toMatch(/unknown tool/)

    await mcpClient.close()
    await server.close()
  })

  it('maps 401 responses to an auth-failed error content block', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import(
      '@modelcontextprotocol/sdk/inMemory.js'
    )

    const fetchImpl = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch
    const httpClient = new HttpClient({
      baseUrl: 'https://api.trulayer.ai',
      apiKey: 'bad',
      fetchImpl,
    })
    const server = buildServer({ client: httpClient })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

    const result = await mcpClient.callTool({ name: 'get_metrics', arguments: {} })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ text: string }>
    expect(content[0]!.text).toMatch(/auth failed/)

    await mcpClient.close()
    await server.close()
  })
})
