# Review protocol · v1.0

The panel receives one shared evidence snapshot and assigns 1–5 distinct model/role slots. The same model may serve different roles; repeated identical model+role pairs are rejected.

| Role | Primary question |
|---|---|
| General Governance | Is the overall proposal responsibly governable? |
| Treasury & Governance Impact | What direct and indirect asset exposure follows? |
| Intent Fidelity | Do exact recipients, amounts and actions match authorized intent? |
| Security & Execution | Do targets, calldata, permissions and execution evidence support the action? |
| Governance Mechanism & Process | What changes in participation, quorum, timing or authority? |

A rejection dominates aggregation. Otherwise all reviewers and deterministic checks must approve for aggregate APPROVE; incomplete/failed reviewers do not count as approval. Different roles may reasonably reach the same verdict. Same-model role diversity is not independent model-family consensus.

Outputs include a work summary, verdict, findings, role assessment and adjustment guidance. Revision text is proposed natural language, never automatic execution. The compile/review loop is manual.

The server signs session ID, review-context fingerprint, verdict and issue time. The browser cannot mint a valid receipt. A receipt expires after 24 hours, or becomes unusable after a restart if the server used an ephemeral secret. Editing source, executable fields or chain context changes review identity. Human override is a separately acknowledged path with prior signed lineage and fresh validation.

The receipt attests server-issued review context, not AI truth, nor Ethereum-level permission. A knowledgeable account holder can interact with Governor outside this UI; contract permissions remain the actual on-chain boundary.
