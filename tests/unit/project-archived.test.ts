import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchSender } from '../../src/batch.js'
import { ForbiddenError, ProjectArchivedError } from '../../src/errors.js'
import type { TraceData } from '../../src/model.js'

function makeTrace(id = 'trace-1'): TraceData {
  return {
    id,
    project_id: 'proj-1',
    session_id: null,
    name: null,
    input: null,
    output: null,
    error: null,
    tags: [],
    metadata: {},
    spans: [],
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }
}

function makeSender(
  overrides?: Partial<{ batchSize: number; flushInterval: number }>,
): BatchSender {
  return new BatchSender(
    'tl_test',
    'https://api.trulayer.ai',
    overrides?.batchSize ?? 50,
    overrides?.flushInterval ?? 60_000,
  )
}

describe('BatchSender — HTTP 403 handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('project-archived 403', () => {
    function make403Archived() {
      return {
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({
          code: 'error.project.archived',
          message:
            'The project associated with this API key has been archived. ' +
            'Unarchive the project to resume ingestion.',
        }),
      }
    }

    it('disables the sender on 403 error.project.archived without retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make403Archived())
      vi.stubGlobal('fetch', fetchMock)

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(1) // no retry
      expect(sender.isDisabled()).toBe(true)
      expect(sender.getFatalError()).toBeInstanceOf(ProjectArchivedError)
    })

    it('logs an actionable error message', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make403Archived())
      vi.stubGlobal('fetch', fetchMock)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Project is archived'),
      )
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('app.trulayer.ai'),
      )
    })

    it('accepts the `error` field as well as `code`', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ error: 'error.project.archived' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.getFatalError()).toBeInstanceOf(ProjectArchivedError)
    })

    it('drops queued items and rejects new enqueues after latching', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make403Archived())
      vi.stubGlobal('fetch', fetchMock)

      const sender = makeSender({ batchSize: 1 })
      sender.enqueue(makeTrace('a')) // triggers send → 403
      await new Promise((r) => setTimeout(r, 10))
      expect(sender.isDisabled()).toBe(true)

      fetchMock.mockClear()
      sender.enqueue(makeTrace('b'))
      sender.enqueue(makeTrace('c'))
      await sender.shutdown()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('generic 403', () => {
    function make403Generic() {
      return {
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ code: 'forbidden' }),
      }
    }

    it('disables the sender on a generic 403 without retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make403Generic())
      vi.stubGlobal('fetch', fetchMock)

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(sender.isDisabled()).toBe(true)
      expect(sender.getFatalError()).toBeInstanceOf(ForbiddenError)
    })

    it('logs an actionable error mentioning HTTP 403', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make403Generic()))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 403'),
      )
    })

    it('disables on a 403 with a non-JSON body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      })
      vi.stubGlobal('fetch', fetchMock)

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.isDisabled()).toBe(true)
      expect(sender.getFatalError()).toBeInstanceOf(ForbiddenError)
    })
  })

  describe('non-403 errors', () => {
    it('500 does not disable the sender', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      )

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.isDisabled()).toBe(false)
      expect(sender.getFatalError()).toBeNull()
    })

    it('400 does not disable the sender', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: vi.fn().mockResolvedValue({ error: 'bad_request' }),
        }),
      )

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.isDisabled()).toBe(false)
      expect(sender.getFatalError()).toBeNull()
    })

    it('422 does not disable the sender', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: vi.fn().mockResolvedValue({ error: 'unprocessable' }),
        }),
      )

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.isDisabled()).toBe(false)
      expect(sender.getFatalError()).toBeNull()
    })
  })

  describe('instance scope', () => {
    it('a fresh client instance starts with isDisabled() === false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          json: vi.fn().mockResolvedValue({ code: 'error.project.archived' }),
        }),
      )

      const s1 = makeSender()
      s1.enqueue(makeTrace('a'))
      await s1.shutdown()
      expect(s1.isDisabled()).toBe(true)

      // A new sender does not inherit the disabled state.
      const s2 = makeSender()
      expect(s2.isDisabled()).toBe(false)
      expect(s2.getFatalError()).toBeNull()
    })
  })
})

describe('error shape', () => {
  it('ProjectArchivedError carries the actionable message', () => {
    const err = new ProjectArchivedError()
    expect(err.name).toBe('ProjectArchivedError')
    expect(err.message).toContain('archived')
    expect(err.message).toContain('app.trulayer.ai')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ProjectArchivedError)
  })

  it('ForbiddenError carries the actionable message', () => {
    const err = new ForbiddenError()
    expect(err.name).toBe('ForbiddenError')
    expect(err.message).toContain('403')
    expect(err.message).toContain('app.trulayer.ai')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ForbiddenError)
  })
})
