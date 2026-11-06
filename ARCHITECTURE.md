# YanFu architecture · v1.0

YanFu separates probabilistic interpretation, deterministic encoding, current-chain evidence, AI advice and human signing authority.

1. `backend/proposal/generator.js` checks explicit source constraints, asks the selected model for a capability-bounded plan, validates typed arguments and constructs Governor arrays.
2. `backend/proposal/encoder.js` performs deterministic unit conversion and ABI encoding using configured capabilities.
3. `backend/chain/context.js` and `simulator.js` obtain current contract state and Timelock-origin calls, including cumulative Treasury preflight. They do not forecast future state or execute every arbitrary dependency as an ordered forked batch.
4. `backend/review/` builds shared evidence, performs 1–5 role-specific reviews, aggregates by the configured unanimous policy and produces revision guidance.
5. `frontend/assets/js/editor.js` maintains explicit edit/confirmation gates. `backend/proposal/editor.js` rebuilds or accepts exact human payloads and validates them against fresh chain context.
6. `backend/review/attestation.js` signs review provenance with a server-held HMAC secret. `/api/review/verify` checks the receipt immediately before the frontend opens the wallet.
7. `frontend/assets/js/wallet.js` sends Governor.propose through an EIP-1193 provider. Governor voting and Timelock execution occur later.

## Two distinct identities

The review-context fingerprint includes Governor arrays, description, original source text, metadata source text and recorded chain identity. The on-chain Governor proposal ID uses its standard formula and must not be confused with the review hash. Human edits change review identity even when some execution fields are unchanged.

Hash namespace strings, API/config schema revisions and the localStorage key are compatibility data. The public release number is independent of them.

## Human authority

Only the Human Confirm stage exposes editing. Guided semantic edits and exact raw-payload edits are mutually exclusive. An exact edit marks old semantic metadata stale; review evidence decodes the actual calldata where supported. Unknown calldata is not described as decoded.

After an actual rewrite, fresh validation and two explicit human confirmations are required. A stale review can serve as signed lineage only through the configured acknowledgment path; it does not become approval of the new payload. Unapplied edits block submission. Negative AI recommendations may also be overridden explicitly under the configured human-authority policy.

## Local runtime boundary

Express binds locally and applies exact browser-origin checks, request limits and AI concurrency caps. This is local development protection, not authenticated multi-user service design. Provider credentials remain server-side. Public JSON configuration must contain no secrets.
