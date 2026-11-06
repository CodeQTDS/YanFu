# Testing YanFu v1.0

Run `npm ci`, `npm run setup` and `npm run compile` first. The application source and model defaults are unchanged by the public version-label reset. Test command names now describe their purpose without development-version prefixes.

## Local regression commands

| Command | Coverage |
|---|---|
| `npm run check` | File/config validation, stage gates and targeted regressions |
| `npm run check:publication` | Product labels, local template setup, Git ignore rules and safe examples |
| `npm run test:capabilities` | 15 built-in/registered-template cases |
| `npm run test:security` | Signed receipts, source amounts/provenance and API guards |
| `npm run test:audit-security` | Adversarial validation, mocked simulator and browser-state guards |
| `npm run test:reencoding` | Executable consistency independent of provenance |
| `npm run test:compiler-diagnostics` | Token symbols, compiler output and reviewer failures |
| `npm run test:address-preflight` | Explicit malformed-address rejection before AI |
| `npm run test:human-authority` | Rewrite opt-in, dirty state and confirmation gates in a VM |
| `npm run test:review-models` | Role assignments, repeated models and provider adapter shapes |
| `npm run test:review-roles` / `test:review-policy` | Evidence and role-policy regressions |
| `npm run test:evm` | 19 actual Hardhat EVM tests |
| `npm run test:http-evm` | 11 actual HTTP/RPC scenarios with synthetic signed review fixtures |
| `npm run test:treasury` / `test:treasury-atomic` | Individual Treasury EVM suites |

The combined gate runs the offline checks by default and reports EVM/live/wallet omissions explicitly. To include EVM and HTTP:

```powershell
$env:YANFU_RELEASE_EVM='1'
npm run test:release-gate
Remove-Item Env:YANFU_RELEASE_EVM
```

Ports **8545 and 3300 must be free**. The HTTP suite starts services in a temporary project copy and removes it afterward. It refuses to reuse an occupied chain port. Do not point tests at live assets. The gate writes a timestamped JSON report to ignored `test/auto/results/`.

Passing EIP-1193 adapter tests is not passing MetaMask UI automation. Passing synthetic receipt tests is not evidence that an LLM approved anything. Current-state production simulation does not become ordered future-state simulation because lifecycle regressions pass.

## Live AI tests — optional provider usage

Start the real local chain, deploy, fund required Treasury fixtures and start the backend. Configure accessible models in `.env`. The standard pipeline has 242 cases, 101 enabled and 141 disabled optional cases. It covers Compile → Analyze → AI Review, without wallet submission.

Start with the 12 enabled smoke cases:

```powershell
$env:YANFU_TEST_TAG='smoke'
npm run test:auto-ai
Remove-Item Env:YANFU_TEST_TAG
```

Run the complete enabled suite:

```powershell
npm run test:auto-ai
```

Compilation and analysis use the runner's fixed ModelScope Qwen profile, independent of the interactive UI default. Its three reviewers have fixed default models/roles for comparability. Override only reviewer 3 for a controlled provider comparison:

```powershell
$env:YANFU_TEST_REVIEWER_3='modelscope:qwen3.5-35b-a3b'
npm run test:auto-ai
Remove-Item Env:YANFU_TEST_REVIEWER_3
```

For a smaller diagnostic set:

```powershell
$env:YANFU_TEST_CASE_FILE='test/auto/yanfu-provider-retry-cases.json'
npm run test:auto-ai
Remove-Item Env:YANFU_TEST_CASE_FILE
```

`yanfu-risk-followup-cases.json` is another retained targeted fixture. The case inputs, expected outcomes and enabled flags are unchanged; fixture titles now target the public v1.0 release. Do not silently alter expectations to force a pass.

## Five-role live integration

```powershell
$env:YANFU_FIVE_REVIEW_MODEL='modelscope:qwen3.5-35b-a3b'
npm run test:live-five-reviewers
Remove-Item Env:YANFU_FIVE_REVIEW_MODEL
```

This separate runner checks five role assignments and completed results, not artificial disagreement. It does not use `YANFU_TEST_REVIEWER_3` and does not submit a transaction.

## Reports and interpretation

HTML, JSON and CSV live reports are saved under ignored `test/auto/results/`. Distinguish semantic mismatches, deterministic blockers and provider/DNS/quota failures. A skipped optional test is not a pass. Keep provider credentials and raw local account logs out of shared evidence.

Optional combined live flags are `YANFU_RELEASE_LIVE_AI=1` and `YANFU_RELEASE_LIVE_FIVE=1`. They consume real API usage. MetaMask/browser acceptance remains the manual checklist in [ACCEPTANCE.md](ACCEPTANCE.md).
