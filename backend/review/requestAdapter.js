"use strict";

const DEFAULT_PROFILE_ID = "general-governance";

function cleanModelId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReviewerEntry(entry, index, body = {}) {
  if (typeof entry === "string") {
    return {
      model: cleanModelId(entry),
      profileId: Array.isArray(body.profiles)
        ? (body.profiles[index] || body.profileId || DEFAULT_PROFILE_ID)
        : (body.profileId || DEFAULT_PROFILE_ID)
    };
  }

  return {
    model: cleanModelId(entry?.model || entry?.modelId || entry?.id),
    profileId: entry?.profileId || entry?.profile || body.profileId || DEFAULT_PROFILE_ID
  };
}

/**
 * Accepts every review payload shape used by YanFu so far:
 *
 * v3 canonical:
 *   reviewers: [{ model, profileId }, ...]
 *
 * legacy multi-review UI:
 *   models: ["provider:model", ...]
 *
 * legacy single-review UI:
 *   model: "provider:model"
 *
 * The returned shape is always the canonical reviewer specification used by
 * backend/review/orchestrator.js. This boundary intentionally isolates HTTP/UI
 * evolution from the reviewer engine and future compiler↔review loops.
 */
function normalizeReviewerRequest(body = {}) {
  let source = [];
  let sourceFormat = "none";

  if (Array.isArray(body.reviewers) && body.reviewers.length > 0) {
    source = body.reviewers;
    sourceFormat = "reviewers";
  } else if (Array.isArray(body.models) && body.models.length > 0) {
    source = body.models;
    sourceFormat = "models";
  } else if (cleanModelId(body.model)) {
    source = [body.model];
    sourceFormat = "model";
  }

  const reviewers = source
    .map((entry, index) => normalizeReviewerEntry(entry, index, body))
    .filter(item => item.model);

  return {
    reviewers,
    sourceFormat
  };
}

function normalizeReviewRoundContext(body = {}) {
  if (body.roundContext && typeof body.roundContext === "object") {
    return body.roundContext;
  }

  const round = Number(body.iteration || body.round || 1);
  return {
    round: Number.isInteger(round) && round > 0 ? round : 1,
    parentSessionId: body.parentSessionId || body.parentReviewSessionId || null,
    sourceIteration: body.iterationContext || null
  };
}

module.exports = {
  DEFAULT_PROFILE_ID,
  normalizeReviewerRequest,
  normalizeReviewRoundContext
};
