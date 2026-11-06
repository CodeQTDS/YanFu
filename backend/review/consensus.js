const { loadReviewersConfig } = require("../config/configLoader");

function dedupeText(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function verdictDistribution(reviews) {
  return reviews.reduce((acc, review) => {
    const verdict = String(review.verdict || "NEEDS_CHANGES").toUpperCase();
    acc[verdict] = (acc[verdict] || 0) + 1;
    return acc;
  }, {});
}

function agreementLabel(reviews, distribution) {
  if (reviews.length === 1) return "SINGLE_REVIEWER";
  const counts = Object.values(distribution);
  if (counts.length === 1) return "UNANIMOUS";
  if (Math.max(...counts) > reviews.length / 2) return "MAJORITY";
  return "SPLIT";
}

function selectRevisionCandidate(reviews) {
  const candidates = reviews
    .filter(review => review.verdict !== "APPROVE" && review.revisedNaturalLanguage)
    .map(review => ({
      reviewerId: review.reviewerId,
      model: review.model,
      profile: review.profile,
      verdict: review.verdict,
      confidence: review.confidence,
      revisedNaturalLanguage: review.revisedNaturalLanguage,
      revisionSource: review.revisionSource
    }));

  const ranked = [...candidates].sort((a, b) => {
    const rejectWeightA = a.verdict === "REJECT" ? 1 : 0;
    const rejectWeightB = b.verdict === "REJECT" ? 1 : 0;
    if (rejectWeightA !== rejectWeightB) return rejectWeightB - rejectWeightA;
    return Number(b.confidence || 0) - Number(a.confidence || 0);
  });

  return {
    candidates,
    recommended: ranked[0] || null
  };
}

function aggregateReviewSession({ reviews, evidence }) {
  const config = loadReviewersConfig();
  const distribution = verdictDistribution(reviews);
  const agreement = agreementLabel(reviews, distribution);
  const anyReject = Boolean(distribution.REJECT);
  const allApprove = reviews.length > 0 && reviews.every(review => review.verdict === "APPROVE");

  let verdict;
  if (config.consensus?.rejectDominates && anyReject) {
    verdict = "REJECT";
  } else if (allApprove && evidence.deterministic.passed) {
    verdict = "APPROVE";
  } else {
    verdict = "NEEDS_CHANGES";
  }

  if (
    config.consensus?.deterministicFailureForcesChanges &&
    !evidence.deterministic.passed &&
    verdict === "APPROVE"
  ) {
    verdict = "NEEDS_CHANGES";
  }

  const recommendedAdjustments = dedupeText(
    reviews.flatMap(review => review.recommendedAdjustments || [])
  );

  const revisions = selectRevisionCandidate(reviews);
  const blockingReviewerIds = reviews
    .filter(review => review.verdict !== "APPROVE")
    .map(review => review.reviewerId);

  const readyForHumanConfirmation =
    verdict === "APPROVE" && evidence.deterministic.passed;

  const nextAction = readyForHumanConfirmation
    ? "HUMAN_CONFIRMATION"
    : revisions.recommended
      ? "RECOMPILE_RECOMMENDED"
      : "HUMAN_REVIEW_REQUIRED";

  return {
    verdict,
    qualified: verdict === "APPROVE",
    readyForHumanConfirmation,
    agreement,
    reviewerCount: reviews.length,
    verdictDistribution: distribution,
    blockingReviewerIds,
    deterministicPassed: evidence.deterministic.passed,
    summary: readyForHumanConfirmation
      ? `${reviews.length} reviewer(s) completed review and the proposal passed the configured approval policy.`
      : `Review completed with ${agreement.toLowerCase().replace(/_/g, " ")} agreement. Further human action or recompilation is required.`,
    recommendedAdjustments,
    revisionCandidates: revisions.candidates,
    recommendedRevision: revisions.recommended,
    nextAction
  };
}

module.exports = {
  aggregateReviewSession,
  verdictDistribution,
  agreementLabel,
  selectRevisionCandidate
};
