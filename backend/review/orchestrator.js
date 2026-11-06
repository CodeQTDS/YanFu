const crypto = require("crypto");
const { resolveModel } = require("../ai/modelRegistry");
const { loadReviewersConfig } = require("../config/configLoader");
const { collectReviewEvidence } = require("./evidence");
const { runSingleReviewer, findProfile } = require("./reviewerEngine");
const { aggregateReviewSession } = require("./consensus");

function normalizeReviewerSpecs(reviewers) {
  return (reviewers || []).map((item, index) => {
    if (typeof item === "string") {
      return {
        model: item,
        profileId: "general-governance",
        slot: index + 1
      };
    }

    return {
      model: item?.model,
      profileId: item?.profileId || "general-governance",
      slot: index + 1
    };
  });
}

function validateReviewerSelection(reviewers) {
  const config = loadReviewersConfig();
  const normalized = normalizeReviewerSpecs(reviewers);
  const min = Number(config.limits?.minReviewers || 1);
  const max = Number(config.limits?.maxReviewers || 5);

  if (normalized.length < min || normalized.length > max) {
    throw new Error(`Reviewer count must be between ${min} and ${max}`);
  }

  const modelIdentities = [];
  const modelRolePairs = [];
  for (const [index, reviewer] of normalized.entries()) {
    if (!reviewer.model) {
      throw new Error(`Reviewer ${index + 1} is missing a model`);
    }
    const resolved = resolveModel(reviewer.model);
    const identity = `${resolved.provider}:${String(resolved.model || resolved.id).trim().toLowerCase()}`;
    modelIdentities.push(identity);
    modelRolePairs.push(`${identity}::${reviewer.profileId}`);
    const profileExists = (config.profiles || []).some(item => item.id === reviewer.profileId);
    if (!profileExists) {
      throw new Error(`Reviewer ${index + 1} references unknown profile ${reviewer.profileId}`);
    }
  }

  if (config.limits?.requireUniqueModels) {
    const ids = normalized.map(item => item.model);
    if (new Set(ids).size !== ids.length || new Set(modelIdentities).size !== modelIdentities.length) {
      throw new Error("AI reviewer models must be unique within one review session");
    }
  }

  if (config.limits?.requireUniqueModelRolePairs && new Set(modelRolePairs).size !== modelRolePairs.length) {
    throw new Error("Reviewer model and role combinations must be unique within one review session");
  }

  return normalized;
}

function normalizeRoundContext({ proposal, roundContext }) {
  const iteration = proposal?.metadata?.iterationContext || null;
  const round = Number(
    roundContext?.round ||
    iteration?.requestedReviewRound ||
    iteration?.requestedRound ||
    1
  );

  return {
    round: Number.isInteger(round) && round > 0 ? round : 1,
    parentSessionId:
      roundContext?.parentSessionId ||
      iteration?.parentReviewSessionId ||
      null,
    sourceIteration:
      roundContext?.sourceIteration ||
      iteration ||
      null
  };
}

async function reviewProposalSession({
  proposal,
  analysis = null,
  reviewers,
  roundContext = null
}) {
  if (!proposal) throw new Error("Proposal is required");

  const config = loadReviewersConfig();
  const selectedReviewers = validateReviewerSelection(reviewers);
  const normalizedRound = normalizeRoundContext({ proposal, roundContext });
  const evidence = await collectReviewEvidence(proposal);

  const settledReviews = await Promise.allSettled(
    selectedReviewers.map((reviewer, index) =>
      runSingleReviewer({
        proposal,
        analysis,
        model: reviewer.model,
        profileId: reviewer.profileId,
        reviewerIndex: index,
        evidence,
        roundContext: normalizedRound
      })
    )
  );

  const reviews = settledReviews.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    const reviewer = selectedReviewers[index];
    const profile = findProfile(reviewer.profileId);
    return {
      status: "ERROR",
      reviewerId: `reviewer-${index + 1}`,
      reviewerIndex: index,
      reviewedAt: new Date().toISOString(),
      model: reviewer.model,
      profile: profile ? {
        id: profile.id,
        label: profile.label,
        description: profile.description || ""
      } : null,
      verdict: "NEEDS_CHANGES",
      confidence: 0,
      workSummary: "This reviewer could not complete its review because the model/provider call failed.",
      findings: [{
        source: "reviewer-runtime",
        severity: "HIGH",
        category: "reviewer-unavailable",
        message: result.reason?.message || String(result.reason || "Reviewer failed"),
        suggestion: "Retry the review or choose another available reviewer model."
      }],
      deterministicBlockers: evidence.deterministic.findings || [],
      recommendedAdjustments: ["Retry this review slot with an available model before treating the review team as qualified."],
      revisedNaturalLanguage: null,
      revisionSource: null,
      evidenceFingerprint: evidence.proposalFingerprint,
      error: result.reason?.message || String(result.reason || "Reviewer failed")
    };
  });

  const aggregate = aggregateReviewSession({
    reviews,
    evidence
  });

  const sessionId = crypto.randomUUID();
  const loopState = {
    protocolVersion: config.loopCompatibility?.protocolVersion || "yanfu-review-loop-v1",
    automaticLoopEnabled: Boolean(config.loopCompatibility?.automaticLoopEnabled),
    round: normalizedRound.round,
    parentSessionId: normalizedRound.parentSessionId,
    sessionId,
    proposalFingerprint: evidence.proposalFingerprint,
    canRecompile: aggregate.nextAction === "RECOMPILE_RECOMMENDED",
    nextCompilerInput: aggregate.recommendedRevision?.revisedNaturalLanguage || null,
    nextAction: aggregate.nextAction,
    nextSuggestedRound: aggregate.nextAction === "RECOMPILE_RECOMMENDED"
      ? normalizedRound.round + 1
      : null
  };

  return {
    schemaVersion: 2,
    sessionId,
    createdAt: new Date().toISOString(),
    proposalFingerprint: evidence.proposalFingerprint,
    sourceText: proposal.sourceText || proposal.metadata?.sourceText || proposal.description || "",
    roundContext: normalizedRound,
    reviewerSelection: selectedReviewers,
    reviews,
    aggregate,
    sharedEvidence: evidence,
    loopState
  };
}

module.exports = {
  reviewProposalSession,
  validateReviewerSelection,
  normalizeReviewerSpecs,
  normalizeRoundContext
};
