# Security and deployment scope

YanFu v1.0 is a local governance development/research application. It is not an independently audited production wallet, custody service or public multi-user API.

## Keep local data private

Use `.env.example` and `npm run setup`. Keep real provider credentials and `YANFU_REVIEW_ATTESTATION_SECRET` only in local environment configuration. Never put secrets in public JSON, frontend code, screenshots or logs. The backend exposes selected configuration to the browser.

`.gitignore` excludes local environment files, local RPC/deployment and registered-contract configuration, credential/key formats, wallet directories, dependency/build output, logs and reports. Safe example configurations are included. Ignore rules cannot remove secrets already committed to Git; rotate exposed credentials and clean history.

The backend binds to loopback by default and checks origins, rate/concurrency limits and signed review context. These are not authentication for an Internet-facing service. Do not expose the backend or Hardhat RPC publicly. Use only disposable Hardhat accounts; their keys are well-known and must never hold real assets.

## Review and governance boundaries

AI can misunderstand requests or fail at transport/formatting. Deterministic validation and chain simulation reduce specific errors; they do not prove economic safety or guarantee future execution. Signed receipts bind review context and expire, but do not make model judgments correct. Humans can explicitly override negative/stale review through the supported confirmation path; inspect the exact transaction before signing.

A submitted proposal still needs voting, quorum, queueing and Timelock execution. Default deployment retains development administrative powers; review all roles before considering a different environment.

## Dependencies and reports

Dependencies and contract behavior are deliberately preserved for this label-only release. See [VALIDATION.md](docs/VALIDATION.md) for the recorded dependency audit and test limitations. A zero-failure regression suite is not a security audit.

No security contact has been designated. Before publication, configure a private vulnerability-reporting channel in GitHub. Do not disclose credentials or exploitable sensitive details in public issues.
