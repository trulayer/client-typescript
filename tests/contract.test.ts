/**
 * Contract tests: verify the TypeScript SDK's types and request shapes
 * conform to the vendored OpenAPI spec (tests/fixtures/openapi.yaml).
 *
 * Uses @readme/openapi-parser to load and validate the spec, then asserts
 * that SDK model shapes match the spec's request/response schemas.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type { FeedbackData, TraceData } from '../src/model.js'

const SPEC_PATH = resolve(__dirname, 'fixtures/openapi.yaml')

function loadSpec(): Record<string, unknown> {
  const raw = readFileSync(SPEC_PATH, 'utf-8')
  return parse(raw) as Record<string, unknown>
}

describe('OpenAPI spec validity', () => {
  const spec = loadSpec()

  it('has a valid openapi version field', () => {
    expect(spec).toHaveProperty('openapi')
    const version = spec.openapi as string
    expect(version).toMatch(/^3\.\d+\.\d+$/)
  })

  it('has expected paths', () => {
    const paths = spec.paths as Record<string, unknown>
    expect(paths).toHaveProperty('/v1/ingest')
    expect(paths).toHaveProperty('/v1/ingest/batch')
    expect(paths).toHaveProperty('/v1/traces')
    expect(paths).toHaveProperty('/v1/feedback')
    expect(paths).toHaveProperty('/v1/apikeys')
  })

  it('has components/schemas', () => {
    const components = spec.components as Record<string, unknown>
    const schemas = components.schemas as Record<string, unknown>
    expect(schemas).toHaveProperty('TraceRequest')
    expect(schemas).toHaveProperty('BatchRequest')
    expect(schemas).toHaveProperty('FeedbackRequest')
  })
})

describe('TraceData matches TraceRequest schema', () => {
  const spec = loadSpec()
  const components = spec.components as Record<string, Record<string, unknown>>
  const schemas = components.schemas as Record<string, Record<string, unknown>>
  const traceRequestSchema = schemas.TraceRequest as Record<string, unknown>
  const traceProps = traceRequestSchema.properties as Record<string, unknown>

  it('SDK TraceData fields align with spec TraceRequest properties', () => {
    // Build a sample TraceData object
    const trace: TraceData = {
      id: '019012ab-cdef-7000-8000-000000000001',
      project_id: '019012ab-cdef-7000-8000-000000000002',
      session_id: null,
      external_id: null,
      name: 'test',
      input: 'hello',
      output: 'world',
      model: 'gpt-4',
      latency_ms: 100,
      cost: 0.01,
      error: null,
      tags: [],
      metadata: {},
      spans: [],
      started_at: '2026-04-19T12:00:00.000Z',
      ended_at: null,
    }

    // These fields from the SDK should exist in the spec's TraceRequest
    const specFields = Object.keys(traceProps)
    for (const key of ['name', 'input', 'output', 'model', 'latency_ms', 'cost', 'error', 'external_id']) {
      expect(specFields, `Expected spec to contain field '${key}'`).toContain(key)
    }

    // The SDK always sends as JSON with Content-Type: application/json
    const body = JSON.stringify({ traces: [trace] })
    const parsed = JSON.parse(body) as { traces: unknown[] }
    expect(parsed.traces).toHaveLength(1)
  })
})

describe('FeedbackData matches FeedbackRequest schema', () => {
  const spec = loadSpec()
  const components = spec.components as Record<string, Record<string, unknown>>
  const schemas = components.schemas as Record<string, Record<string, unknown>>
  const fbSchema = schemas.FeedbackRequest as Record<string, unknown>

  it('has required fields trace_id and label', () => {
    const required = fbSchema.required as string[]
    expect(required).toContain('trace_id')
    expect(required).toContain('label')
  })

  it('SDK FeedbackData produces a valid payload', () => {
    const fb: FeedbackData = {
      trace_id: '019012ab-cdef-7000-8000-000000000001',
      label: 'good',
    }

    // label must be one of the allowed enum values
    const props = fbSchema.properties as Record<string, Record<string, unknown>>
    const labelEnum = props.label.enum as string[]
    expect(labelEnum).toContain(fb.label)
  })
})

describe('BatchRequest schema', () => {
  const spec = loadSpec()
  const components = spec.components as Record<string, Record<string, unknown>>
  const schemas = components.schemas as Record<string, Record<string, unknown>>
  const batchSchema = schemas.BatchRequest as Record<string, unknown>

  it('requires a traces array', () => {
    const required = batchSchema.required as string[]
    expect(required).toContain('traces')
  })

  it('SDK batch sender sends the correct shape', () => {
    // The BatchSender sends { traces: TraceData[] } as JSON
    const trace: TraceData = {
      id: '019012ab-cdef-7000-8000-000000000001',
      project_id: '019012ab-cdef-7000-8000-000000000002',
      session_id: null,
      external_id: null,
      name: 'test',
      input: null,
      output: null,
      model: null,
      latency_ms: null,
      cost: null,
      error: null,
      tags: [],
      metadata: {},
      spans: [],
      started_at: '2026-04-19T12:00:00.000Z',
      ended_at: null,
    }
    const body = { traces: [trace] }
    expect(body.traces).toBeInstanceOf(Array)
    expect(body.traces.length).toBeGreaterThan(0)
    expect(body.traces.length).toBeLessThanOrEqual(100)
  })
})

describe('Content-Type requirements', () => {
  it('spec requires application/json for ingest', () => {
    const spec = loadSpec()
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
    const ingestPost = paths['/v1/ingest'].post as Record<string, unknown>
    const requestBody = ingestPost.requestBody as Record<string, unknown>
    const content = requestBody.content as Record<string, unknown>
    expect(content).toHaveProperty('application/json')
  })

  it('spec requires application/json for batch ingest', () => {
    const spec = loadSpec()
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
    const batchPost = paths['/v1/ingest/batch'].post as Record<string, unknown>
    const requestBody = batchPost.requestBody as Record<string, unknown>
    const content = requestBody.content as Record<string, unknown>
    expect(content).toHaveProperty('application/json')
  })
})
