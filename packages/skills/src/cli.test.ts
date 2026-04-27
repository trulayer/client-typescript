import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cli = resolve(__dirname, '..', 'dist', 'cli.js')
const tmp = resolve(__dirname, '..', '.test-tmp')

function run(args: string, cwd = tmp): string {
  return execSync(`node ${cli} ${args}`, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  mkdirSync(tmp, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('@trulayer/skills CLI', () => {
  it('list shows available skills', () => {
    const out = run('list')
    expect(out).toContain('/tl-init')
    expect(out).toContain('/tl-instrument')
    expect(out).toContain('/tl-trace')
  })

  it('install copies skill files to .claude/commands/', () => {
    const out = run('install')
    expect(out).toContain('installed')
    expect(existsSync(resolve(tmp, '.claude', 'commands', 'tl-init.md'))).toBe(true)
    expect(existsSync(resolve(tmp, '.claude', 'commands', 'tl-instrument.md'))).toBe(true)
    expect(existsSync(resolve(tmp, '.claude', 'commands', 'tl-trace.md'))).toBe(true)
  })

  it('install skips existing files without --force', () => {
    run('install')
    const out = run('install')
    expect(out).toContain('skip')
    expect(out).not.toContain('added')
  })

  it('install overwrites with --force', () => {
    run('install')
    const out = run('install --force')
    expect(out).toContain('added')
  })

  it('unknown command exits 1', () => {
    expect(() => run('unknown')).toThrow()
  })
})
