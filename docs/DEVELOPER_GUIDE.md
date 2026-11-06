# Developer guide · v1.0

## Source layout

| Directory/file | Responsibility |
|---|---|
| `backend/ai/` | Provider transport and model catalog resolution |
| `backend/proposal/` | Source checks, capability plans, encoding, analysis and human editing |
| `backend/review/` | Evidence, role reviews, consensus and signed receipts |
| `backend/chain/` | JSON-RPC provider, context and preflight |
| `backend/routes/` | HTTP endpoints |
| `frontend/` | Browser-native HTML/CSS/JS; no bundler |
| `contracts/` | MyToken, MyGovernor, Treasury, DAOSettings and DAOContractFactory |
| `config/` | Public policies/catalogs and ignored local deployment settings |
| `scripts/` | Setup, deployment and test runners |
| `test/`, `audit/` | EVM, live-AI fixtures and dependency-free regression cases |

Use `npm ci` and retain the lockfile. Runtime dependencies and Solidity sources were not changed for the public label reset. Do not globally replace dependency/model/schema version numbers.

## Stable interfaces

Keep capability IDs and argument meanings stable. Treat any change to Governor arrays, source provenance or human override policy as a functional change with relevant tests. Avoid changing review hash namespaces or browser storage keys as part of cosmetic rebranding.

The browser API address is currently a constant in `frontend/assets/js/api.js`. `app.config.json` also contains API metadata used by test clients. Changing one does not automatically change the other.

## Local changes

Run setup before the checker. Keep `.env`, deployed chain configuration and custom registrations private. For a new capability, add typed config/ABI coverage and a deployed test fixture before enabling optional cases. For reviewer changes, update role policy, adapter shape, UI and tests together.

Use [TESTING.md](TESTING.md) for regression commands, [CONFIGURATION.md](CONFIGURATION.md) for fields and [ACCEPTANCE.md](ACCEPTANCE.md) for real wallet/provider checks. Full EVM/HTTP testing does not prove live model reliability or user-interface correctness.

## Release metadata

Display/tag: **v1.0**. SemVer: **1.0.0** in VERSION, package.json, lockfile root and app.config.json. Public test fixture targets match that SemVer. Manifests inventory source files; they exclude themselves, ignored files and generated output.

This package starts a new public repository. Private development documents remain in the prior source archive and are not republished as fictitious v1.0 historical audits.
