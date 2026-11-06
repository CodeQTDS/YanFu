const { ethers } = require("ethers");
const { buildCapabilityRegistry } = require("./capabilityRegistry");
const { validatePlan, validateGovernorProposalShape } = require("./validator");
const { buildGovernorProposal } = require("./encoder");
const { proposalFingerprint } = require("./integrity");
const { getChainContext } = require("../chain/context");
const { simulateProposalCalls } = require("../chain/simulator");

function planFromActions(actions, description) {
  return {
    status: "ready",
    intentSummary: description || "Human-edited governance proposal",
    description: description || "Human-edited governance proposal",
    operations: (actions || []).map(item => ({
      capabilityId: item.capabilityId,
      arguments: item.arguments || {}
    })),
    unresolved: [],
    assumptions: []
  };
}

async function rebuildProposal({ proposal, actions, description }) {
  const registry = buildCapabilityRegistry();
  const sourceText = proposal?.sourceText || proposal?.metadata?.sourceText || "";
  const plan = planFromActions(actions, description);
  const validation = validatePlan({ plan, registry, sourceText, enforceProtected: false });

  if (!validation.valid) {
    throw new Error(`Edited proposal validation failed: ${validation.errors.join("; ")}`);
  }

  const rebuilt = buildGovernorProposal({
    plan,
    registry,
    description,
    metadata: {
      ...(proposal?.metadata || {}),
      editedAt: new Date().toISOString(),
      editedBy: "HUMAN",
      humanGovernorOverride: false,
      semanticPlanStatus: "CURRENT"
    }
  });

  rebuilt.draftId = proposal?.draftId || null;
  rebuilt.sourceText = sourceText;
  rebuilt.plan = plan;
  rebuilt.generatorModel = proposal?.generatorModel || null;
  rebuilt.editable = true;
  rebuilt.fingerprint = proposalFingerprint(rebuilt);
  return rebuilt;
}

function normalizeGovernorArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be a JSON array`);
  }
  return value.map((item, index) => {
    if (item === null || item === undefined) {
      throw new Error(`${name}[${index}] is required`);
    }
    return String(item).trim();
  });
}

/**
 * Highest-authority human path.
 *
 * This intentionally does NOT rebuild from configured semantic capabilities.
 * The human supplies the exact Governor.propose() payload that will later be
 * validated and, after explicit acknowledgement, signed by the browser wallet.
 * Semantic actions/plan are preserved only as historical lineage and are marked
 * stale so callers never mistake them for the authoritative final payload.
 */
function applyHumanGovernorOverride({ proposal, description, targets, values, calldatas }) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("Existing proposal is required for human Governor override");
  }

  const normalizedTargets = normalizeGovernorArray(targets, "targets");
  const normalizedValues = normalizeGovernorArray(values, "values");
  const normalizedCalldatas = normalizeGovernorArray(calldatas, "calldatas");
  const normalizedDescription = String(description || "").trim();

  if (!normalizedTargets.length) {
    throw new Error("Final Governor proposal must contain at least one target");
  }

  for (const [index, value] of normalizedValues.entries()) {
    try {
      const bn = ethers.BigNumber.from(value);
      if (bn.lt(0)) throw new Error("negative");
    } catch (_) {
      throw new Error(`values[${index}] must be a valid non-negative uint256 value`);
    }
  }

  const previousFingerprint = proposal.fingerprint || proposalFingerprint(proposal);
  const overridden = {
    ...proposal,
    description: normalizedDescription,
    targets: normalizedTargets,
    values: normalizedValues,
    calldatas: normalizedCalldatas,
    metadata: {
      ...(proposal.metadata || {}),
      editedAt: new Date().toISOString(),
      editedBy: "HUMAN",
      humanGovernorOverride: true,
      previousFingerprint,
      semanticPlanStatus: "STALE_AFTER_FINAL_GOVERNOR_OVERRIDE"
    },
    editable: true
  };

  const shape = validateGovernorProposalShape(overridden);
  if (!shape.valid) {
    throw new Error(`Final Governor proposal shape is invalid: ${shape.errors.join("; ")}`);
  }

  overridden.fingerprint = proposalFingerprint(overridden);
  return overridden;
}

async function validateProposalForSubmission(proposal) {
  const shape = validateGovernorProposalShape(proposal);
  const [chainContext, simulation] = await Promise.all([
    getChainContext(),
    shape.valid ? simulateProposalCalls(proposal) : Promise.resolve(null)
  ]);

  const errors = [...shape.errors];
  if (Number(chainContext.chainId) !== Number(chainContext.expectedChainId)) {
    errors.push(`Connected chain ${chainContext.chainId} does not match configured chain ${chainContext.expectedChainId}`);
  }
  const proposalChainId = proposal?.metadata?.chainId ?? proposal?.chainContext?.chainId;
  if (proposalChainId != null && Number(proposalChainId) !== Number(chainContext.chainId)) {
    errors.push(`Proposal chain ${proposalChainId} does not match connected chain ${chainContext.chainId}; compile and review again on the intended chain.`);
  }
  if (simulation && !simulation.allSuccessful) {
    for (const failed of (simulation.results || []).filter(r => !r.success)) {
      errors.push(`Action ${failed.index + 1}: ${failed.error || "Failed current-state simulation"}`);
    }
    errors.push("Proposal creation does not execute Treasury transfers; these actions currently fail preflight.");
  }

  return {
    valid: errors.length === 0,
    errors,
    chainContext,
    simulation,
    fingerprint: proposalFingerprint(proposal),
    validatedAt: new Date().toISOString()
  };
}

module.exports = {
  rebuildProposal,
  applyHumanGovernorOverride,
  validateProposalForSubmission,
  planFromActions
};
