const express = require("express");
const { generateProposal } = require("../proposal/generator");
const { analyzeProposal } = require("../proposal/analyzer");
const { reviewProposal } = require("../proposal/reviewer");
const { reviewProposalSession } = require("../review/orchestrator");
const {
  rebuildProposal,
  applyHumanGovernorOverride,
  validateProposalForSubmission
} = require("../proposal/editor");
const { shortFingerprint } = require("../utils/logger");
const {
  normalizeReviewerRequest,
  normalizeReviewRoundContext
} = require("../review/requestAdapter");

const { issueReviewAttestation, verifyReviewAttestation } = require("../review/attestation");
const { proposalFingerprint } = require("../proposal/integrity");
const router = express.Router();

function actionCount(proposal) {
  return Array.isArray(proposal?.actions) ? proposal.actions.length : 0;
}

router.post("/generate", async (req, res) => {
  const started = Date.now();
  req.log?.step("AI GENERATION · compiler started", {
    model: req.body.model || "default",
    inputChars: String(req.body.text || "").length,
    iteration: req.body.iterationContext?.requestedRound || 1
  });

  try {
    const proposal = await generateProposal({
      text: req.body.text,
      model: req.body.model,
      iterationContext: req.body.iterationContext || null
    });

    req.log?.step("AI GENERATION · executable proposal ready", {
      fingerprint: shortFingerprint(proposal?.fingerprint),
      actions: actionCount(proposal),
      targets: Array.isArray(proposal?.targets) ? proposal.targets.length : 0,
      elapsedMs: Date.now() - started
    });

    res.json({ success: true, proposal });
  } catch (error) {
    const status = ["NEEDS_CLARIFICATION", "INPUT_CONFLICT", "SOURCE_INTENT_MISMATCH"].includes(error.code) ? 422 : 500;
    req.log?.error("AI GENERATION · failed", error, {
      status,
      model: req.body.model || "default",
      code: error.code || null,
      elapsedMs: Date.now() - started
    });
    res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || null,
      plan: error.plan || null,
      inputValidation: error.inputValidation || null
    });
  }
});

router.post("/analyze", async (req, res) => {
  const started = Date.now();
  const proposal = req.body.proposal;
  req.log?.step("AI ANALYSIS · chain-grounded analysis started", {
    model: req.body.model || "default",
    fingerprint: shortFingerprint(proposal?.fingerprint),
    actions: actionCount(proposal)
  });

  try {
    const analysis = await analyzeProposal({
      proposal,
      model: req.body.model
    });

    req.log?.step("AI ANALYSIS · completed", {
      risk: analysis?.riskScore?.level || analysis?.risk || analysis?.aiRisk || "—",
      score: analysis?.riskScore?.score ?? analysis?.riskScore ?? "—",
      simulation: analysis?.simulation?.allSuccessful === false ? "FAILED" : "completed",
      elapsedMs: Date.now() - started
    });

    res.json({ success: true, analysis });
  } catch (error) {
    req.log?.error("AI ANALYSIS · failed", error, {
      model: req.body.model || "default",
      fingerprint: shortFingerprint(proposal?.fingerprint),
      elapsedMs: Date.now() - started
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/* Backward-compatible one-reviewer endpoint. */
router.post("/review", async (req, res) => {
  const started = Date.now();
  req.log?.step("AI REVIEW · single reviewer started", {
    model: req.body.model || "default",
    fingerprint: shortFingerprint(req.body.proposal?.fingerprint)
  });

  try {
    const review = await reviewProposal({
      proposal: req.body.proposal,
      analysis: req.body.analysis || null,
      model: req.body.model
    });

    req.log?.step("AI REVIEW · completed", {
      verdict: review?.verdict || "—",
      confidence: review?.confidence ?? "—",
      elapsedMs: Date.now() - started
    });

    res.json({ success: true, review });
  } catch (error) {
    req.log?.error("AI REVIEW · failed", error, {
      model: req.body.model || "default",
      elapsedMs: Date.now() - started
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/*
 * Primary multi-review endpoint.
 * reviewers: 1..5 model/role selections (a model may hold multiple different roles).
 * roundContext remains part of the contract for a future compiler↔reviewer loop.
 */
router.post("/review/session", async (req, res) => {
  const started = Date.now();
  const normalized = normalizeReviewerRequest(req.body || {});
  const reviewers = normalized.reviewers;
  const roundContext = normalizeReviewRoundContext(req.body || {});

  req.log?.step("AI REVIEW PANEL · shared evidence + independent reviewers started", {
    reviewerCount: reviewers.length,
    models: reviewers.map(item => item.model),
    profiles: reviewers.map(item => item.profileId),
    requestFormat: normalized.sourceFormat,
    fingerprint: shortFingerprint(req.body.proposal?.fingerprint),
    round: roundContext.round || 1
  });

  try {
    const reviewSession = await reviewProposalSession({
      proposal: req.body.proposal,
      analysis: req.body.analysis || null,
      reviewers,
      roundContext
    });

    req.log?.step("AI REVIEW PANEL · session complete", {
      sessionId: reviewSession?.sessionId || "—",
      verdict: reviewSession?.aggregate?.verdict || "—",
      agreement: reviewSession?.aggregate?.agreement || "—",
      completedReviewers: Array.isArray(reviewSession?.reviews)
        ? reviewSession.reviews.filter(item => item?.status !== "ERROR").length
        : 0,
      fingerprint: shortFingerprint(reviewSession?.proposalFingerprint),
      elapsedMs: Date.now() - started
    });

    reviewSession.attestation = issueReviewAttestation(reviewSession);
    res.json({
      success: true,
      reviewSession
    });
  } catch (error) {
    const message = String(error.message || "");
    const isSelectionError =
      /reviewer count|reviewer models must be unique|reviewer model and role combinations must be unique|missing a model|unknown profile|unsupported ai model/i.test(message);
    const status = isSelectionError ? 422 : 500;

    req.log?.error("AI REVIEW PANEL · failed", error, {
      status,
      reviewerCount: reviewers.length,
      models: reviewers.map(item => item?.model).filter(Boolean),
      elapsedMs: Date.now() - started
    });

    res.status(status).json({
      success: false,
      error: error.message
    });
  }
});

// The browser's localStorage does not prove a review occurred.
// This verification must succeed immediately before opening MetaMask.
router.post("/review/verify", (req, res) => {
  try {
    const {proposal,reviewSession,humanEditContext}=req.body || {};
    if (!proposal) return res.status(422).json({success:false,error:"Proposal is required"});
    if (proposal.fingerprint !== proposalFingerprint(proposal)) {
      return res.status(422).json({success:false,error:"Proposal review-context fingerprint is stale"});
    }
    const priorReviewedFingerprint = humanEditContext?.priorReviewSessionId === reviewSession?.sessionId
      ? humanEditContext?.priorReviewedFingerprint : null;
    const verification = verifyReviewAttestation({proposal,reviewSession,priorReviewedFingerprint});
    return res.status(verification.valid ? 200 : 403).json({success:verification.valid,verification,error:verification.valid ? null : verification.reason});
  } catch (error) {
    return res.status(403).json({success:false,error:"Review attestation verification failed"});
  }
});

router.post("/proposal/rebuild", async (req, res) => {
  const started = Date.now();
  const oldFingerprint = req.body.proposal?.fingerprint;

  req.log?.step("HUMAN EDIT · deterministic rebuild started", {
    oldFingerprint: shortFingerprint(oldFingerprint),
    actions: Array.isArray(req.body.actions) ? req.body.actions.length : 0
  });

  try {
    const proposal = await rebuildProposal({
      proposal: req.body.proposal,
      actions: req.body.actions,
      description: req.body.description
    });

    req.log?.step("HUMAN EDIT · rebuild complete", {
      oldFingerprint: shortFingerprint(oldFingerprint),
      newFingerprint: shortFingerprint(proposal?.fingerprint),
      changed: Boolean(oldFingerprint && proposal?.fingerprint && oldFingerprint !== proposal.fingerprint),
      elapsedMs: Date.now() - started
    });

    res.json({ success: true, proposal });
  } catch (error) {
    req.log?.error("HUMAN EDIT · rebuild failed", error, {
      oldFingerprint: shortFingerprint(oldFingerprint),
      elapsedMs: Date.now() - started
    });
    res.status(422).json({ success: false, error: error.message });
  }
});

router.post("/proposal/human-override", async (req, res) => {
  const started = Date.now();
  const oldFingerprint = req.body.proposal?.fingerprint;

  req.log?.step("HUMAN AUTHORITY · final Governor override started", {
    oldFingerprint: shortFingerprint(oldFingerprint),
    targets: Array.isArray(req.body.targets) ? req.body.targets.length : 0
  });

  try {
    const proposal = applyHumanGovernorOverride({
      proposal: req.body.proposal,
      description: req.body.description,
      targets: req.body.targets,
      values: req.body.values,
      calldatas: req.body.calldatas
    });

    req.log?.step("HUMAN AUTHORITY · final Governor override applied", {
      oldFingerprint: shortFingerprint(oldFingerprint),
      newFingerprint: shortFingerprint(proposal?.fingerprint),
      elapsedMs: Date.now() - started
    });

    res.json({ success: true, proposal });
  } catch (error) {
    req.log?.error("HUMAN AUTHORITY · final Governor override failed", error, {
      oldFingerprint: shortFingerprint(oldFingerprint),
      elapsedMs: Date.now() - started
    });
    res.status(422).json({ success: false, error: error.message });
  }
});

router.post("/proposal/validate", async (req, res) => {
  const started = Date.now();
  const proposal = req.body.proposal;

  req.log?.step("VALIDATION · fresh submission validation started", {
    fingerprint: shortFingerprint(proposal?.fingerprint),
    actions: actionCount(proposal)
  });

  try {
    const validation = await validateProposalForSubmission(proposal);

    req.log?.step("VALIDATION · completed", {
      valid: validation.valid,
      errors: Array.isArray(validation.errors) ? validation.errors.length : 0,
      fingerprint: shortFingerprint(validation?.fingerprint || proposal?.fingerprint),
      elapsedMs: Date.now() - started
    });

    res.status(validation.valid ? 200 : 422).json({
      success: validation.valid,
      validation,
      error: validation.valid ? null : validation.errors.join("; ")
    });
  } catch (error) {
    req.log?.error("VALIDATION · failed", error, {
      fingerprint: shortFingerprint(proposal?.fingerprint),
      elapsedMs: Date.now() - started
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
