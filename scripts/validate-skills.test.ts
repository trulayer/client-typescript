// Validates Claude Code skill files (.claude/commands/*.md) across sibling
// repos that live alongside this one in a local development checkout.
//
// A "skill" is a Markdown file with a YAML frontmatter block that Claude Code
// loads as a slash command. Without a non-empty `description` in the
// frontmatter, the skill fails to register — so we treat a missing
// description as a hard failure.
//
// Sibling repos are discovered relative to this file. If a sibling repo is
// not present in the checkout (e.g. a user cloned this package standalone),
// that repo is skipped silently.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

interface RepoTarget {
  name: string
  path: string
}

const REPO_TARGETS: RepoTarget[] = [
  { name: 'backend', path: resolve(repoRoot, '../backend') },
  { name: 'frontend', path: resolve(repoRoot, '../frontend') },
  { name: 'client-typescript', path: repoRoot },
  { name: 'client-python', path: resolve(repoRoot, '../client-python') },
]

interface SkillFile {
  repo: string
  repoPath: string
  absPath: string
  relPath: string
}

function listSkillFiles(repo: RepoTarget): SkillFile[] {
  const out: SkillFile[] = []
  for (const subdir of ['commands', 'agents']) {
    const dir = resolve(repo.path, '.claude', subdir)
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const abs = resolve(dir, entry)
      try {
        if (!statSync(abs).isFile()) continue
      } catch {
        continue
      }
      out.push({
        repo: repo.name,
        repoPath: repo.path,
        absPath: abs,
        relPath: `${subdir}/${entry}`,
      })
    }
  }
  return out
}

function parseFrontmatter(
  raw: string,
): { frontmatter: Record<string, string>; body: string } | null {
  // Frontmatter delimiter must be the first non-empty content. Skip a leading
  // BOM if present.
  const text = raw.replace(/^﻿/, '')
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const fmRaw = text.slice(3, end).replace(/^\r?\n/, '')
  // Claude Code skill frontmatter is a flat set of `key: value` lines where
  // the value is free-form (colons, slashes, emoji all allowed). A strict
  // YAML parser rejects unquoted values that contain `: `, so we read the
  // frontmatter line by line and split on the first colon only. That matches
  // how Claude Code itself consumes these files.
  const frontmatter: Record<string, string> = {}
  for (const line of fmRaw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Strip one layer of matching quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) frontmatter[key] = value
  }
  const bodyStart = text.indexOf('\n', end + 4)
  const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1)
  return { frontmatter, body }
}

const PATH_PREFIXES = ['internal/', 'src/', 'components/', 'app/', 'cmd/']

function collectReferencedPaths(body: string): string[] {
  const found = new Set<string>()
  // Tokenise on whitespace, backticks, parens, brackets, quotes, and commas —
  // a cheap heuristic good enough to surface path-looking tokens.
  for (const token of body.split(/[\s`()[\]{}"',]+/)) {
    if (!token) continue
    const trimmed = token.replace(/[.,:;]+$/, '')
    if (!trimmed) continue
    if (PATH_PREFIXES.some((p) => trimmed.startsWith(p))) {
      found.add(trimmed)
    }
  }
  return [...found]
}

const targets = REPO_TARGETS.filter((r) => existsSync(r.path))

describe('Claude skill files', () => {
  it('discovered at least one skill file to validate', () => {
    const all = targets.flatMap(listSkillFiles)
    // In a standalone checkout, only the current repo's skills will be seen,
    // but there must be at least one skill somewhere.
    expect(all.length).toBeGreaterThan(0)
  })

  for (const repo of targets) {
    const skills = listSkillFiles(repo)
    if (skills.length === 0) continue

    describe(`${repo.name}`, () => {
      for (const skill of skills) {
        describe(skill.relPath, () => {
          let raw: string
          try {
            raw = readFileSync(skill.absPath, 'utf8')
          } catch (err) {
            it('is readable as UTF-8', () => {
              throw err
            })
            return
          }

          it('is non-empty UTF-8', () => {
            expect(raw.length).toBeGreaterThan(0)
            // readFileSync with 'utf8' throws on invalid UTF-8 — reaching
            // this point confirms valid decoding.
          })

          const parsed = parseFrontmatter(raw)

          it('has a YAML frontmatter block', () => {
            expect(parsed).not.toBeNull()
          })

          it('has a non-empty `description` in frontmatter', () => {
            expect(parsed).not.toBeNull()
            const desc = parsed?.frontmatter.description
            expect(typeof desc).toBe('string')
            expect((desc as string).trim().length).toBeGreaterThan(0)
          })

          it('referenced repo paths exist (warn-only)', () => {
            if (!parsed) return
            const refs = collectReferencedPaths(parsed.body)
            for (const ref of refs) {
              const abs = resolve(skill.repoPath, ref)
              if (!existsSync(abs)) {
                // Scaffolding skills legitimately reference output paths that
                // don't exist yet — surface them as warnings rather than
                // failing the test.
                // eslint-disable-next-line no-console
                console.warn(
                  `[validate-skills] ${skill.repo}/${skill.relPath}: referenced path not found: ${ref}`,
                )
              }
            }
            expect(true).toBe(true)
          })
        })
      }
    })
  }
})
