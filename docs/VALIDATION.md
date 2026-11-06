# v1.0 validation record

Execution date: 2026-11-02 (UTC). Environment: Linux, Node 24.22.1, npm 11.9.0. This is a local regression record, not a production certification or independent audit.

## Executed checks

| Check | Result |
|---|---|
| Locked dependency installation | `npm ci` succeeded from clean ZIP extraction; 309 packages installed |
| Combined gate, `YANFU_RELEASE_EVM=1 npm run test:release-gate` | **19 passed, 0 failed, 2 skipped, 1 manual** |
| Hardhat/EVM tests within the gate | **19 passed**; actual local EVM execution |
| HTTP/Hardhat RPC integration within the gate | **11 passed**; actual HTTP server and chain, synthetic signed review receipts |
| Clean ZIP reproduction | Setup and full EVM-enabled gate passed again: 19 pass / 0 fail / 2 skip / 1 manual |
| Git staging | Private/generated files excluded; staged whitespace check passed with Solidity CRLF explicitly preserved |
| Capability/template checks | 15 passed |
| Deterministic re-encoding | 500 review cases exercised |
| Publication checks | Version consistency; blank credential templates; 19 ignored and 6 publishable path cases; setup creates missing files and preserves existing files; documentation links |
| Production dependency audit | **14 low, 0 moderate, 0 high, 0 critical** findings; retained elliptic dependency chain |

The combined gate intentionally reports `PARTIAL_NONPRODUCTION`: live Compile/Analyze/Review and five-role provider checks were skipped, and real MetaMask signing remains manual. A tested EIP-1193 adapter is not an installed-wallet UI test. No live model-quality or provider-availability claim is made.

## Functionality preservation

Compared against source archive SHA-256 `90de5117892a8aae8f54a4872f110613e71a193ded06a202af5704b977dcc804`:

- **58 files byte-identical**, covering all backend files, frontend JavaScript, Solidity contracts, Hardhat configuration, deployment code, model catalog and review/prompt policies.
- CSS changes only a release comment. Capability configuration changes only release wording in its description.
- Dependency lock contents are identical except root package version fields. No dependency upgrades were made.
- Main AI test case inputs and assertions are unchanged except two message-string product labels. Model IDs, enabled flags and test expectations are preserved.
- App metadata, HTML branding, report/test names and release documentation now identify v1.0 (`1.0.0` in npm). Internal schemas, API versions, review hash namespace and browser storage key remain compatible.
- Local setup and publication checks are packaging/developer additions. Local default configurations come from the same baseline values through safe templates.

No runtime defect was found by these regression checks. Documentation and publication packaging were corrected without changing runtime logic.

## Reproduce and interpret

Follow [TESTING.md](TESTING.md) after setup. The distributable excludes generated reports and local configuration; verification evidence is delivered separately. For the pending acceptance checklist, see [ACCEPTANCE.md](ACCEPTANCE.md).

Dependency audit is a point-in-time registry result, not proof of absence of vulnerabilities. The preserved frontend CDN bundle is ethers 5.7.2; the backend uses locked ethers 5.8.0. Dependency upgrades need their own review and are not part of a label-only change.
