/**
 * Client-side PII, secret, and PHI redaction.
 *
 * Use `Redactor` to scrub sensitive values from strings or structured
 * trace/span objects before they leave your process. Supports built-in
 * entity packs (`standard`, `strict`, `phi`, `finance`, `secrets`),
 * user-defined `Rule`s, optional HMAC-SHA256 pseudonymization, and
 * field-path targeting via `redactSpan`.
 *
 * The module is runtime-agnostic — it uses only regular expressions and
 * `globalThis.crypto.subtle` for pseudonymization, so it works in Node,
 * browsers, Edge runtimes, and Bun.
 */

export type PackName = 'standard' | 'strict' | 'phi' | 'finance' | 'secrets'

export interface Rule {
  /** Short identifier used to build the default `<REDACTED:{name}>` token. */
  name: string
  /** Regex string or `RegExp`. If a `RegExp`, it is used as-is (be sure to set `g`). */
  pattern: string | RegExp
  /** Optional replacement token. Defaults to `<REDACTED:{name}>`. */
  replacement?: string
  /**
   * Per-rule pseudonymization. `true`/`false` override the Redactor default.
   * `undefined` (the default) inherits the Redactor setting.
   */
  pseudonymize?: boolean
  /** Optional validator — match is redacted only when this returns true. */
  validator?: (match: string) => boolean
}

export interface RedactorOptions {
  packs?: PackName[]
  rules?: Rule[]
  /** When true, every rule pseudonymizes by default. Requires `pseudonymizeSalt`. */
  pseudonymize?: boolean
  /** Secret used for HMAC-SHA256. Required whenever any rule pseudonymizes. */
  pseudonymizeSalt?: string
  /** Hex chars of the HMAC digest kept in the emitted token. Default 8. */
  pseudonymLength?: number
}

interface CompiledRule {
  name: string
  pattern: RegExp
  replacement?: string | undefined
  pseudonymize?: boolean | undefined
  validator?: ((m: string) => boolean) | undefined
}

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g
const BEARER = /Bearer\s+[A-Za-z0-9._\-]+/g
const JWT = /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g
const PHONE = /(?<!\d)(?:\+\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.\-]\d{3}[\s.\-]\d{3,4}(?!\d)/g

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g
const CC_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g

const MRN = /MRN[:\s]?\d{6,10}/g
const ICD10 = /\b[A-TV-Z]\d{2}(?:\.\d{1,2})?\b/g
const DOB =
  /\b(?:(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}|(?:19|20)\d{2}[/\-](?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01]))\b/g

const SWIFT = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g
const ROUTING = /\b\d{9}\b/g
const ACCOUNT = /\b\d{8,17}\b/g
const TICKER_AMOUNT = /\$[A-Z]{1,5}\s*\$?\d+(?:,\d{3})*(?:\.\d+)?/g

const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g
const GITHUB_PAT = /\bgh[pousr]_[A-Za-z0-9]{36}\b/g
const PEM_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g
const GCP_SA =
  /"type"\s*:\s*"service_account"[\s\S]{0,200}?"private_key"\s*:\s*"[^"]+"/g

function luhnOk(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '').split('').map((c) => Number(c))
  if (digits.length < 13 || digits.length > 19) return false
  let checksum = 0
  const parity = digits.length % 2
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i]!
    if (i % 2 === parity) {
      d *= 2
      if (d > 9) d -= 9
    }
    checksum += d
  }
  return checksum % 10 === 0
}

type PackEntry = { name: string; pattern: RegExp; validator?: (m: string) => boolean }

export const BUILTIN_PACKS: Record<PackName, PackEntry[]> = {
  standard: [
    { name: 'email', pattern: EMAIL },
    { name: 'ssn', pattern: SSN },
    { name: 'jwt', pattern: JWT },
    { name: 'bearer_token', pattern: BEARER },
    { name: 'phone', pattern: PHONE },
  ],
  strict: [
    { name: 'email', pattern: EMAIL },
    { name: 'ssn', pattern: SSN },
    { name: 'jwt', pattern: JWT },
    { name: 'bearer_token', pattern: BEARER },
    { name: 'credit_card', pattern: CC_CANDIDATE, validator: luhnOk },
    { name: 'iban', pattern: IBAN },
    { name: 'ipv4', pattern: IPV4 },
    { name: 'phone', pattern: PHONE },
  ],
  phi: [
    { name: 'mrn', pattern: MRN },
    { name: 'icd10', pattern: ICD10 },
    { name: 'dob', pattern: DOB },
  ],
  finance: [
    { name: 'swift_bic', pattern: SWIFT },
    { name: 'routing_number', pattern: ROUTING },
    { name: 'account_number', pattern: ACCOUNT },
    { name: 'ticker_amount', pattern: TICKER_AMOUNT },
  ],
  secrets: [
    { name: 'aws_access_key', pattern: AWS_KEY },
    { name: 'github_pat', pattern: GITHUB_PAT },
    { name: 'pem_private_key', pattern: PEM_BLOCK },
    { name: 'gcp_service_account', pattern: GCP_SA },
  ],
}

// ---------------------------------------------------------------------------
// Redactor
// ---------------------------------------------------------------------------

function ensureGlobal(re: RegExp): RegExp {
  if (re.global) return re
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
  return new RegExp(re.source, flags)
}

function compile(rule: Rule): CompiledRule {
  const pattern =
    typeof rule.pattern === 'string'
      ? new RegExp(rule.pattern, 'g')
      : ensureGlobal(rule.pattern)
  return {
    name: rule.name,
    pattern,
    replacement: rule.replacement,
    pseudonymize: rule.pseudonymize,
    validator: rule.validator,
  }
}

/** Synchronous HMAC-SHA256 shim — pure JS, no runtime dependencies. */
function hmacSha256Hex(keyBytes: Uint8Array, msg: string): string {
  // Implemented inline so the module stays runtime-agnostic (works where
  // `crypto.subtle` is async-only, e.g., browsers and edge runtimes).
  const BLOCK = 64
  let key = keyBytes
  if (key.length > BLOCK) key = sha256Bytes(key)
  const padded = new Uint8Array(BLOCK)
  padded.set(key)
  const oKey = new Uint8Array(BLOCK)
  const iKey = new Uint8Array(BLOCK)
  for (let i = 0; i < BLOCK; i++) {
    oKey[i] = padded[i]! ^ 0x5c
    iKey[i] = padded[i]! ^ 0x36
  }
  const msgBytes = new TextEncoder().encode(msg)
  const inner = concat(iKey, msgBytes)
  const innerHash = sha256Bytes(inner)
  const outer = concat(oKey, innerHash)
  return bytesToHex(sha256Bytes(outer))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0')
  return s
}

// Minimal SHA-256 over bytes. Pure JS, ~80 LOC, no deps.
function sha256Bytes(message: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const l = message.length
  const withOne = new Uint8Array(l + 1)
  withOne.set(message)
  withOne[l] = 0x80
  const padLen = (64 - ((withOne.length + 8) % 64)) % 64
  const total = new Uint8Array(withOne.length + padLen + 8)
  total.set(withOne)
  // bit length as big-endian 64-bit
  const bitLen = BigInt(l) * 8n
  const view = new DataView(total.buffer)
  view.setUint32(total.length - 8, Number((bitLen >> 32n) & 0xffffffffn), false)
  view.setUint32(total.length - 4, Number(bitLen & 0xffffffffn), false)

  const w = new Uint32Array(64)
  for (let i = 0; i < total.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3)
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10)
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!]
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + mj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    H[0] = (H[0]! + a) >>> 0
    H[1] = (H[1]! + b) >>> 0
    H[2] = (H[2]! + c) >>> 0
    H[3] = (H[3]! + d) >>> 0
    H[4] = (H[4]! + e) >>> 0
    H[5] = (H[5]! + f) >>> 0
    H[6] = (H[6]! + g) >>> 0
    H[7] = (H[7]! + h) >>> 0
  }
  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]!, false)
  return out
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

export class Redactor {
  private readonly rules: CompiledRule[]
  private readonly pseudonymizeDefault: boolean
  private readonly pseudonymLength: number
  private readonly saltBytes: Uint8Array | null

  constructor(opts: RedactorOptions = {}) {
    const pseudonymLength = opts.pseudonymLength ?? 8
    if (pseudonymLength < 4 || pseudonymLength > 64) {
      throw new Error('[trulayer] pseudonymLength must be between 4 and 64')
    }
    this.pseudonymLength = pseudonymLength
    this.pseudonymizeDefault = opts.pseudonymize === true
    this.saltBytes = opts.pseudonymizeSalt
      ? new TextEncoder().encode(opts.pseudonymizeSalt)
      : null

    const rules: CompiledRule[] = []
    for (const pack of opts.packs ?? []) {
      const entries = BUILTIN_PACKS[pack]
      if (!entries) {
        throw new Error(
          `[trulayer] unknown pack '${pack}'; available: ${Object.keys(BUILTIN_PACKS).join(', ')}`,
        )
      }
      for (const e of entries) {
        rules.push({ name: e.name, pattern: ensureGlobal(e.pattern), validator: e.validator })
      }
    }
    for (const r of opts.rules ?? []) rules.push(compile(r))
    this.rules = rules

    const needsSalt =
      this.pseudonymizeDefault || this.rules.some((r) => r.pseudonymize === true)
    if (needsSalt && this.saltBytes === null) {
      throw new Error('[trulayer] pseudonymize=true requires pseudonymizeSalt')
    }
  }

  redact(text: string): string {
    if (typeof text !== 'string' || text.length === 0) return text
    let out = text
    for (const rule of this.rules) {
      rule.pattern.lastIndex = 0
      out = out.replace(rule.pattern, (match) => this.replacementFor(rule, match))
    }
    return out
  }

  redactSpan<T extends Record<string, unknown>>(
    span: T,
    fields: readonly string[] = ['input', 'output', 'metadata'],
  ): T {
    const copy: Record<string, unknown> = { ...span }
    for (const path of fields) applyToPath(copy, path.split('.'), (v) => this.redactValue(v))
    return copy as T
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === 'string') return this.redact(value)
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = this.redactValue(v)
      return out
    }
    return value
  }

  private replacementFor(rule: CompiledRule, match: string): string {
    if (rule.validator && !rule.validator(match)) return match
    const usePseudo = rule.pseudonymize ?? this.pseudonymizeDefault
    if (usePseudo) {
      if (!this.saltBytes) return `<REDACTED:${rule.name}>`
      const digest = hmacSha256Hex(this.saltBytes, match)
      return `<PSEUDO:${digest.slice(0, this.pseudonymLength)}>`
    }
    return rule.replacement ?? `<REDACTED:${rule.name}>`
  }
}

function applyToPath(
  root: unknown,
  path: string[],
  transform: (v: unknown) => unknown,
): void {
  if (path.length === 0) return
  const [key, ...rest] = path
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const obj = root as Record<string, unknown>
    if (!(key! in obj)) return
    if (rest.length === 0) {
      obj[key!] = transform(obj[key!])
    } else {
      applyToPath(obj[key!], rest, transform)
    }
  } else if (Array.isArray(root)) {
    for (const item of root) applyToPath(item, path, transform)
  }
}

/**
 * One-shot convenience wrapper. For repeated use construct a `Redactor`
 * directly so regex compilation is amortized.
 */
export function redact(text: string, opts: RedactorOptions = {}): string {
  return new Redactor({ packs: ['standard'], ...opts }).redact(text)
}
