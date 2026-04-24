# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| 0.0.x   | :white_check_mark: (placeholder release; not for production use) |

We support the latest released minor version. Older versions receive security
fixes only when there is no safe upgrade path.

## Reporting a Vulnerability

Please report vulnerabilities privately to **security@trulayer.ai** or via the
[GitHub Security Advisories](https://github.com/trulayer/client-typescript/security/advisories/new)
flow on this repository.

- Include a clear description, reproduction steps, and the version affected.
- Do **not** open a public GitHub issue for security reports.
- We aim to acknowledge within 5 business days. This is a best-effort SLA;
  formal SLAs will be published when the SDK reaches `1.0.0`.
- A PGP key for encrypted disclosures will be published here once available.

## Disclosure

We will coordinate disclosure timing with the reporter. Please give us a
reasonable window to ship a fix before publishing details.

## Release signing & supply-chain integrity

Every `@trulayer/sdk` release published to npm is:

1. **Built in GitHub Actions** from a tagged commit in this repository.
2. **Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)**,
   which binds the package to the exact workflow run and source commit that
   produced it (Sigstore-backed, verifiable with `npm audit signatures`).
3. **Signed with [cosign](https://docs.sigstore.dev/cosign/overview/)** in
   keyless mode using the workflow's short-lived OIDC identity. There are no
   long-lived signing keys.
4. **Logged in the [Rekor](https://docs.sigstore.dev/logging/overview/)
   transparency log** — every signature is publicly auditable at
   <https://search.sigstore.dev/>.
5. **Accompanied by a [CycloneDX](https://cyclonedx.org/) SBOM** attached to
   the corresponding GitHub Release.

### Verifying npm provenance

```bash
npm install -g @trulayer/sdk@latest
npm audit signatures
```

`npm audit signatures` confirms that the tarball downloaded from the
registry matches the provenance attestation npm recorded at publish time.

### Verifying the cosign signature on the GitHub Release tarball

The signed tarball and its `.sigstore` bundle are attached to each GitHub
Release under <https://github.com/trulayer/client-typescript/releases>.

```bash
# 1. Install cosign
brew install cosign   # or: go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# 2. Download the tarball, its cosign bundle, and the SBOM from the Release
VERSION=0.1.0
curl -LO "https://github.com/trulayer/client-typescript/releases/download/v${VERSION}/trulayer-sdk-${VERSION}.tgz"
curl -LO "https://github.com/trulayer/client-typescript/releases/download/v${VERSION}/trulayer-sdk-${VERSION}.tgz.sigstore"

# 3. Verify it was signed by this repo's release.yml at the matching tag
cosign verify-blob \
  --bundle "trulayer-sdk-${VERSION}.tgz.sigstore" \
  --certificate-identity "https://github.com/trulayer/client-typescript/.github/workflows/release.yml@refs/tags/v${VERSION}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "trulayer-sdk-${VERSION}.tgz"
```

A successful run prints `Verified OK`. Any tampering, identity mismatch, or
missing Rekor entry will fail the verification.

### Finding the Rekor transparency log entry

Every signature is a public Rekor entry. Look it up at
<https://search.sigstore.dev/> by searching the artifact's SHA-256 digest.

### SBOM

The CycloneDX JSON SBOM is attached to each GitHub Release as
`trulayer-sdk-<version>-sbom.cdx.json`. It captures the resolved dependency
graph at build time and is itself cosign-signed.
