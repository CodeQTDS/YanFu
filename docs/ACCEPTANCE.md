# Manual and live acceptance

Status for this package: automated offline, real EVM and HTTP/RPC evidence is in [VALIDATION.md](VALIDATION.md). **Actual MetaMask extension interaction and live AI-provider acceptance are not verified.** Browser-gate unit tests and the EIP-1193 test transport do not replace them.

## Wallet workflow checklist

Use the disposable local deployment and development browser profile described in the [README](../README.md).

- [ ] Select a working provider/model; Generate → Analyze → AI Review → Human Confirm completes.
- [ ] Direct navigation cannot bypass workflow prerequisites.
- [ ] Missing provider credentials and failed reviews display errors, not approval.
- [ ] Editing a reviewed action invalidates current approval and requires fresh checks and acknowledgments.
- [ ] Wrong chain is rejected; reconnecting to the configured chain succeeds.
- [ ] Cancel the wallet connection request and a transaction request; errors are recoverable.
- [ ] Confirm a local proposal transaction; verify its receipt and Governor proposal ID.
- [ ] Confirm that submission alone did not change settings or Treasury balances.
- [ ] Complete voting/queue/execution separately and verify resulting state.
- [ ] Restart the backend with an ephemeral receipt secret; old receipts require review again.

Record OS, browser, MetaMask version, chain ID, provider/model IDs, date and each result. Never capture private keys or provider tokens in evidence.

## Live providers

Follow [TESTING.md](TESTING.md) for the opt-in smoke and five-role suites. Record actual provider failures, skips and model IDs; catalog presence is not proof of availability. Do not mark a skipped check as passed. These checks can consume paid API quota.
