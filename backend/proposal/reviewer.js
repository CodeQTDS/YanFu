/*
 * Backward-compatible single-reviewer adapter.
 *
 * New code should use backend/review/orchestrator.js and
 * POST /api/review/session so one to five role-specific
 * reviewers can participate in the same evidence-grounded round.
 */
const { reviewProposalSession } = require("../review/orchestrator");
const { deterministicReview } = require("../review/evidence");

async function reviewProposal({ proposal, analysis = null, model }) {
  const session = await reviewProposalSession({
    proposal,
    analysis,
    reviewers: [
      {
        model,
        profileId: "general-governance"
      }
    ]
  });

  return {
    ...session.reviews[0],
    sessionId: session.sessionId,
    aggregate: session.aggregate,
    loopState: session.loopState,
    sharedEvidence: session.sharedEvidence
  };
}

module.exports = {
  reviewProposal,
  deterministicReview
};
