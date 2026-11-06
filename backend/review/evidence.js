const { buildCapabilityRegistry } = require("../proposal/capabilityRegistry");
const { sourceIntentConsistencyReview } = require("../proposal/sourceIntentGuard");
const { validatePlan, validateGovernorProposalShape } = require("../proposal/validator");
const { buildGovernorProposal } = require("../proposal/encoder");
const { proposalFingerprint, governorExecutionFingerprint } = require("../proposal/integrity");
const { getChainContext } = require("../chain/context");
const { simulateProposalCalls } = require("../chain/simulator");
const { analyzeProposalActions } = require("../proposal/actionAnalyzer");
const { decodeExecutableProposal } = require("./executableEvidence");

function deterministicReview({ proposal, chainContext, simulation, actionAnalysis = null }) {
  const findings = [];
  const registry = buildCapabilityRegistry();
  const historicalPlan = proposal?.metadata?.semanticPlanStatus === "STALE_AFTER_FINAL_GOVERNOR_OVERRIDE" ||
    proposal?.metadata?.humanGovernorOverride === true;
  const executableActions = decodeExecutableProposal(proposal, registry);
  // After an exact human override, never use historical action data as proof
  // that explicit source addresses remain in the current executable calls.
  const intentProposal = historicalPlan ? {
    ...proposal,
    plan: null,
    actions: executableActions.filter(item => item.decoded)
      .map(item => ({capabilityId:item.capabilityId, target:item.target, arguments:item.arguments, encodedArguments:item.encodedArguments}))
  } : proposal;
  const sourceIntent = sourceIntentConsistencyReview({ proposal: intentProposal, registry });
  findings.push(...sourceIntent.findings);
  findings.push(...(actionAnalysis?.findings || []));
  const shape = validateGovernorProposalShape(proposal);

  for (const error of shape.errors) {
    findings.push({
      source: "deterministic",
      severity: "CRITICAL",
      category: "proposal-structure",
      message: error,
      suggestion: "Rebuild the proposal before submission."
    });
  }

  if (Number(chainContext.chainId) !== Number(chainContext.expectedChainId)) {
    findings.push({
      source: "deterministic",
      severity: "CRITICAL",
      category: "chain-id-consistency",
      message: `Connected chain ${chainContext.chainId} does not match configured chain ${chainContext.expectedChainId}.`,
      suggestion: "Switch to the configured chain or intentionally update chain.config.json."
    });
  }

  for (const [name, status] of Object.entries(chainContext.contracts || {})) {
    if (status?.validAddress && !status?.hasCode) {
      findings.push({
        source: "deterministic",
        severity: "HIGH",
        category: "target-contract-code",
        message: `Configured contract ${name} at ${status.address} has no deployed bytecode.`,
        suggestion: "Verify deployment and chain configuration before submission."
      });
    }
  }

  (simulation.results || []).forEach(item => {
    if (!item.success) {
      findings.push({
        source: "deterministic",
        severity: "HIGH",
        category: "call-simulation",
        actionIndex: item.index,
        message: item.error || "Call simulation failed",
        suggestion: "Resolve the revert, permission, balance or target issue before submission."
      });
    }
  });

  if (!historicalPlan && proposal.plan && Array.isArray(proposal.plan.operations)) {
    const sourceText = proposal.sourceText || proposal.metadata?.sourceText || "";
    const validation = validatePlan({
      plan: proposal.plan,
      registry,
      sourceText
    });

    for (const error of validation.errors) {
      findings.push({
        source: "deterministic",
        severity: "HIGH",
        category: "capability-fit",
        message: error,
        suggestion: "Correct the semantic action and rebuild deterministic calldata."
      });
    }

    if (validation.valid) {
      const rebuilt = buildGovernorProposal({
        plan: proposal.plan,
        registry,
        description: proposal.description,
        metadata: proposal.metadata || {}
      });

      // Compare only the Governor-executable fields. The full review-context
      // fingerprint includes sourceText and chain provenance, which an
      // ephemeral rebuilt proposal does not carry and must not be used here.
      const originalFingerprint = governorExecutionFingerprint(proposal);
      const rebuiltFingerprint = governorExecutionFingerprint(rebuilt);

      if (originalFingerprint !== rebuiltFingerprint) {
        findings.push({
          source: "deterministic",
          severity: "CRITICAL",
          category: "deterministic-reencoding",
          message: "Encoded proposal does not match deterministic encoding of its semantic plan.",
          suggestion: "Rebuild encoded fields from semantic actions before any further review or submission."
        });
      }
    }
  }

  return {
    passed: !findings.some(item => ["HIGH", "CRITICAL"].includes(String(item.severity).toUpperCase())),
    findings,
    sourceIntent,
    historicalPlan,
    executableActions
  };
}

async function collectReviewEvidence(proposal) {
  const [chainContext, simulation] = await Promise.all([
    getChainContext(),
    simulateProposalCalls(proposal)
  ]);

  const historicalPlan = proposal?.metadata?.semanticPlanStatus === "STALE_AFTER_FINAL_GOVERNOR_OVERRIDE" ||
    proposal?.metadata?.humanGovernorOverride === true;
  const executableActions = decodeExecutableProposal(proposal);
  // Historical semantic action summaries may no longer represent the payload.
  const authoritativeAnalysisProposal = historicalPlan ? {
    ...proposal,
    actions: executableActions.filter(item => item.decoded).map(item => ({
      ...item, capabilityId:item.capabilityId, target:item.target,
      arguments:item.arguments, encodedArguments:item.encodedArguments
    }))
  } : proposal;
  const actionAnalysis = analyzeProposalActions({ proposal: authoritativeAnalysisProposal, chainContext });
  const deterministic = deterministicReview({
    proposal,
    chainContext,
    simulation,
    actionAnalysis
  });

  return {
    observedAt: new Date().toISOString(),
    proposalFingerprint: proposalFingerprint(proposal),
    chainContext,
    simulation,
    actionAnalysis,
    deterministic,
    sourceIntent: deterministic.sourceIntent,
    executableActions,
    historicalPlan
  };
}

module.exports = {
  deterministicReview,
  collectReviewEvidence
};
