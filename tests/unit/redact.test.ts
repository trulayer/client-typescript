import { describe, expect, it } from 'vitest'
import { BUILTIN_PACKS, Redactor, redact, type Rule } from '../../src/redact.js'

describe('Redactor — built-in packs', () => {
  it('standard pack redacts email', () => {
    const r = new Redactor({ packs: ['standard'] })
    expect(r.redact('ping foo.bar+baz@example.co.uk today')).toBe(
      'ping <REDACTED:email> today',
    )
  })

  it('standard pack redacts ssn, jwt, and bearer token', () => {
    const r = new Redactor({ packs: ['standard'] })
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-123_XYZ'
    const out = r.redact(`ssn=123-45-6789 auth=Bearer abc.DEF-1 token=${jwt}`)
    expect(out).toContain('<REDACTED:ssn>')
    expect(out).toContain('<REDACTED:bearer_token>')
    expect(out).toContain('<REDACTED:jwt>')
    expect(out).not.toContain(jwt)
  })

  it('standard pack redacts phone numbers', () => {
    const r = new Redactor({ packs: ['standard'] })
    expect(r.redact('call +1 415-555-0199 now')).toContain('<REDACTED:phone>')
  })

  it('standard pack leaves benign text alone', () => {
    const r = new Redactor({ packs: ['standard'] })
    const benign = 'The quick brown fox jumps over the lazy dog.'
    expect(r.redact(benign)).toBe(benign)
  })

  it('strict pack redacts ipv4 and valid credit cards only', () => {
    const r = new Redactor({ packs: ['strict'] })
    const out = r.redact('host 10.0.0.25 card 4539 1488 0343 6467 junk 1234 5678 9012 3456')
    expect(out).toContain('<REDACTED:ipv4>')
    expect(out).toContain('<REDACTED:credit_card>')
    // invalid Luhn candidate must NOT be redacted
    expect(out).toContain('1234 5678 9012 3456')
  })

  it('strict pack redacts IBAN', () => {
    const r = new Redactor({ packs: ['strict'] })
    expect(r.redact('IBAN: DE89370400440532013000')).toContain('<REDACTED:iban>')
  })

  it('phi pack redacts mrn, icd10, and dob', () => {
    const r = new Redactor({ packs: ['phi'] })
    const out = r.redact('Patient MRN:1234567 dx E11.9 dob 05/14/1982')
    expect(out).toContain('<REDACTED:mrn>')
    expect(out).toContain('<REDACTED:icd10>')
    expect(out).toContain('<REDACTED:dob>')
  })

  it('finance pack redacts SWIFT/BIC code', () => {
    const r = new Redactor({ packs: ['finance'] })
    expect(r.redact('wire to DEUTDEFFXXX today')).toContain('<REDACTED:swift_bic>')
  })

  it('secrets pack redacts AWS access key, GitHub PAT, and PEM block', () => {
    const r = new Redactor({ packs: ['secrets'] })
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALZF1x\n-----END RSA PRIVATE KEY-----'
    const out = r.redact(
      `aws=AKIAIOSFODNN7EXAMPLE gh=ghp_${'A'.repeat(36)} key:\n${pem}\n`,
    )
    expect(out).toContain('<REDACTED:aws_access_key>')
    expect(out).toContain('<REDACTED:github_pat>')
    expect(out).toContain('<REDACTED:pem_private_key>')
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('unknown pack throws', () => {
    // @ts-expect-error — exercising runtime validation with an invalid pack
    expect(() => new Redactor({ packs: ['nonexistent'] })).toThrow(/unknown pack/)
  })

  it('exposes BUILTIN_PACKS with the documented pack names', () => {
    expect(Object.keys(BUILTIN_PACKS).sort()).toEqual([
      'finance',
      'phi',
      'secrets',
      'standard',
      'strict',
    ])
  })
})

describe('Redactor — custom rules', () => {
  it('string-pattern rule emits default token', () => {
    const r = new Redactor({
      packs: ['standard'],
      rules: [{ name: 'internal_id', pattern: 'EMP-\\d{6}' }],
    })
    expect(r.redact('email foo@bar.com, EMP-123456')).toBe(
      'email <REDACTED:email>, <REDACTED:internal_id>',
    )
  })

  it('regex-pattern rule honors explicit replacement', () => {
    const rule: Rule = { name: 'x', pattern: /secret/g, replacement: '***' }
    const r = new Redactor({ rules: [rule] })
    expect(r.redact('a secret value')).toBe('a *** value')
  })

  it('non-global regex is promoted to global so all matches are replaced', () => {
    const r = new Redactor({ rules: [{ name: 'code', pattern: /[A-Z]{3}-\d{3}/ }] })
    expect(r.redact('ABC-123 and DEF-456')).toBe(
      '<REDACTED:code> and <REDACTED:code>',
    )
  })
})

describe('Redactor — pseudonymization', () => {
  it('is deterministic for the same salt', () => {
    const a = new Redactor({ packs: ['standard'], pseudonymize: true, pseudonymizeSalt: 's3cret' })
    const b = new Redactor({ packs: ['standard'], pseudonymize: true, pseudonymizeSalt: 's3cret' })
    const text = 'email foo@bar.com'
    expect(a.redact(text)).toBe(b.redact(text))
    expect(a.redact(text).startsWith('email <PSEUDO:')).toBe(true)
  })

  it('changes with a different salt', () => {
    const a = new Redactor({ packs: ['standard'], pseudonymize: true, pseudonymizeSalt: 'one' })
    const b = new Redactor({ packs: ['standard'], pseudonymize: true, pseudonymizeSalt: 'two' })
    expect(a.redact('foo@bar.com')).not.toBe(b.redact('foo@bar.com'))
  })

  it('throws when pseudonymize=true without a salt', () => {
    expect(() => new Redactor({ packs: ['standard'], pseudonymize: true })).toThrow(
      /pseudonymizeSalt/,
    )
  })

  it('per-rule opt-out beats the Redactor default', () => {
    const r = new Redactor({
      packs: ['standard'],
      pseudonymize: true,
      pseudonymizeSalt: 'salty',
      rules: [{ name: 'emp', pattern: /EMP-\d+/g, pseudonymize: false }],
    })
    const out = r.redact('EMP-42 foo@bar.com')
    expect(out).toContain('<REDACTED:emp>')
    expect(out).toContain('<PSEUDO:')
  })
})

describe('Redactor — redactSpan', () => {
  it('redacts only the listed top-level fields', () => {
    const r = new Redactor({ packs: ['standard'] })
    const span = {
      id: 'abc',
      input: 'ping me at foo@bar.com',
      output: 'SSN 111-22-3333',
      untouched: 'email ignored@example.com',
    }
    const out = r.redactSpan(span, ['input', 'output'])
    expect(out.input).toContain('<REDACTED:email>')
    expect(out.output).toContain('<REDACTED:ssn>')
    expect(out.untouched).toBe('email ignored@example.com')
    expect(out.id).toBe('abc')
  })

  it('supports dot-path targeting for nested fields', () => {
    const r = new Redactor({ packs: ['standard'] })
    const span = { metadata: { user: { email: 'foo@bar.com', name: 'alice' } } }
    const out = r.redactSpan(span, ['metadata.user.email'])
    expect(out.metadata.user.email).toBe('<REDACTED:email>')
    expect(out.metadata.user.name).toBe('alice')
  })

  it('ignores fields that are absent', () => {
    const r = new Redactor({ packs: ['standard'] })
    const out = r.redactSpan({ input: 'foo@bar.com' }, ['input', 'output', 'metadata.nope'])
    expect(out.input).toBe('<REDACTED:email>')
    expect('output' in out).toBe(false)
  })

  it('recurses into arrays and nested objects within the targeted field', () => {
    const r = new Redactor({ packs: ['standard'] })
    const span = {
      input: ['hello', 'contact foo@bar.com'],
      output: { msg: 'SSN 111-22-3333', n: 7 },
    }
    const out = r.redactSpan(span, ['input', 'output'])
    expect(out.input[1]).toBe('contact <REDACTED:email>')
    expect(out.input[0]).toBe('hello')
    expect(out.output.msg).toBe('SSN <REDACTED:ssn>')
    expect(out.output.n).toBe(7)
  })
})

describe('redact (module-level helper)', () => {
  it('applies the standard pack by default', () => {
    expect(redact('ping foo@bar.com')).toBe('ping <REDACTED:email>')
  })

  it('accepts extra rules', () => {
    expect(redact('ABC-123', { packs: [], rules: [{ name: 'c', pattern: /[A-Z]{3}-\d{3}/g }] })).toBe(
      '<REDACTED:c>',
    )
  })
})
