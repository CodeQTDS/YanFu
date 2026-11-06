"use strict";
const { sha256Json } = require("../utils/hash");

// REVIEW-CONTEXT hash: deliberately separate from Governor.hashProposal(),
// whose on-chain semantics continue to cover targets/values/calldatas/description.
// Bind the originally reviewed request and chain identity to prevent browser
// state edits from silently reusing earlier AI-review evidence.
function proposalFingerprint(proposal) {
  return sha256Json({
    version: "yanfu-review-context-v2",
    targets: proposal?.targets || [],
    values: proposal?.values || [],
    calldatas: proposal?.calldatas || [],
    description: proposal?.description || "",
    sourceText: proposal?.sourceText || "",
    metadataSourceText: proposal?.metadata?.sourceText || "",
    chainId: proposal?.metadata?.chainId ?? proposal?.chainContext?.chainId ?? null,
  });
}
// Executable consistency is a distinct invariant from review provenance.
// Rebuilding the semantic plan has no reason to reproduce top-level sourceText,
// generatedAt, blockNumber or other provenance attributes.  These are covered
// by proposalFingerprint above, not by the execution comparison.
function governorExecutionFingerprint(proposal) {
  return sha256Json({
    version: "yanfu-governor-execution-v1",
    targets: proposal?.targets || [],
    values: proposal?.values || [],
    calldatas: proposal?.calldatas || [],
    description: proposal?.description || ""
  });
}

module.exports = { proposalFingerprint, governorExecutionFingerprint };
