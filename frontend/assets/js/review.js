"use strict";

let publicConfig = null;
let modelCatalog = null;

const FALLBACK_REVIEW_PROFILES = [
  { id: "general-governance", label: "General Governance", description: "Balanced end-to-end review of intent, execution and governance impact." },
  { id: "intent-fidelity", label: "Intent Fidelity", description: "Compare the original natural-language request with semantic actions and encoded execution; flag substitutions or contradictions." },
  { id: "security-execution", label: "Security & Execution", description: "Focus on permissions, targets, calldata consistency, deployment safety and simulation evidence." },
  { id: "treasury-governance", label: "Treasury & Governance Impact", description: "Focus on treasury exposure, parameter changes and governance consequences." },
  { id: "governance-mechanism", label: "Governance Mechanism & Process", description: "Focus on voting, timelocks, authority and execution-order dependencies." }
];

function reviewerProfiles() {
  const configured = publicConfig?.reviewers?.profiles;
  return Array.isArray(configured) && configured.length ? configured : FALLBACK_REVIEW_PROFILES;
}

function profileDefaultSequence() {
  const configured = publicConfig?.reviewers?.profileDefaults;
  return Array.isArray(configured) && configured.length
    ? configured
    : ["general-governance", "treasury-governance", "intent-fidelity", "security-execution", "governance-mechanism"];
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function modelLabel(modelId) {
  return modelCatalog?.models?.find(item => item.id === modelId)?.label || modelId || "Unknown model";
}

function currentRound() {
  const state = DAO_STATE.load();
  return Number(
    state.iterationContext?.requestedReviewRound ||
    state.proposal?.metadata?.iterationContext?.requestedReviewRound ||
    1
  );
}

function getSetup() {
  const state = DAO_STATE.load();
  const max = Math.max(1, Number(publicConfig?.reviewers?.limits?.maxReviewers || 5));
  const count = Math.min(max, Math.max(1, Number(state.reviewSetup?.count || 1)));
  const reviewers = Array.isArray(state.reviewSetup?.reviewers)
    ? state.reviewSetup.reviewers
    : [];
  return { count, reviewers };
}

function defaultReviewer(index) {
  const available = DAO_MODELS.availableModels(modelCatalog);
  const profiles = reviewerProfiles();
  const sequence = profileDefaultSequence();
  const preferredProfile = sequence[index] || sequence[0] || "general-governance";
  return {
    model: available[index]?.id || available[0]?.id || modelCatalog?.defaultModel || "",
    profileId: profiles.some(item => item.id === preferredProfile) ? preferredProfile : (profiles[0]?.id || "general-governance")
  };
}

function profileDescription(profileId) {
  return reviewerProfiles().find(item => item.id === profileId)?.description || "";
}

function renderReviewerSlots() {
  const root = document.getElementById("reviewerSlots");
  const setup = getSetup();
  root.innerHTML = "";

  for (let index = 0; index < setup.count; index++) {
    const stored = setup.reviewers[index] || defaultReviewer(index);
    const row = el("div", "reviewer-slot-row");
    row.dataset.reviewerIndex = String(index);

    const identity = el("div", "reviewer-slot-identity");
    identity.append(
      el("span", "reviewer-number", String(index + 1)),
      el("strong", "", `Reviewer ${index + 1}`)
    );

    const modelField = el("div", "field reviewer-field");
    modelField.append(el("label", "", "AI model"));
    const modelSelect = document.createElement("select");
    modelSelect.className = "reviewer-model";
    modelSelect.dataset.index = String(index);
    DAO_MODELS.populateOptions(modelSelect, modelCatalog, stored.model);
    modelField.append(modelSelect);

    const profileField = el("div", "field reviewer-field");
    profileField.append(el("label", "", "Review role"));
    const profileSelect = document.createElement("select");
    profileSelect.className = "reviewer-profile";
    profileSelect.dataset.index = String(index);
    for (const profile of reviewerProfiles()) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      profileSelect.appendChild(option);
    }
    const availableProfileIds = [...profileSelect.options].map(option => option.value);
    profileSelect.value = availableProfileIds.includes(stored.profileId)
      ? stored.profileId
      : (profileDefaultSequence()[index] || availableProfileIds[0] || "general-governance");
    profileField.append(profileSelect);

    const help = el("div", "reviewer-role-help muted small", profileDescription(profileSelect.value));
    const updateHelp = () => {
      help.textContent = profileDescription(profileSelect.value);
    };

    modelSelect.addEventListener("change", persistSetupFromUi);
    profileSelect.addEventListener("change", () => {
      updateHelp();
      persistSetupFromUi();
    });

    const fields = el("div", "reviewer-slot-fields");
    fields.append(modelField, profileField);
    row.append(identity, fields, help);
    root.append(row);
  }

  validateSelection();
}

function collectReviewerSpecs() {
  const modelSelects = [...document.querySelectorAll(".reviewer-model")];
  return modelSelects.map((modelSelect, index) => ({
    model: modelSelect.value,
    profileId: document.querySelector(`.reviewer-profile[data-index="${index}"]`)?.value || "general-governance"
  }));
}

function persistSetupFromUi() {
  const count = Number(document.getElementById("reviewerCount")?.value || 1);
  const reviewers = collectReviewerSpecs();
  DAO_STATE.save({ reviewSetup: { count, reviewers } });
  validateSelection();
}

function validateSelection() {
  const button = document.getElementById("reviewBtn");
  const reviewers = collectReviewerSpecs();
  const available = DAO_MODELS.availableModels(modelCatalog);
  const availableIds = new Set(available.map(item => item.id));
  const max = Number(publicConfig?.reviewers?.limits?.maxReviewers || 5);
  const min = Number(publicConfig?.reviewers?.limits?.minReviewers || 1);
  const pairs = reviewers.map(item => `${item.model}::${item.profileId}`);
  const duplicatePair = new Set(pairs).size !== pairs.length;
  const missing = reviewers.some(item => !item.model || !availableIds.has(item.model) || !item.profileId);

  if (reviewers.length < min || reviewers.length > max) {
    DAO_UI.setStatus("selectionStatus", `Select between ${min} and ${max} review slots.`, "warning");
    button.disabled = true;
    return false;
  }
  if (!available.length || missing) {
    DAO_UI.setStatus("selectionStatus", "Choose a configured, available model and role for every slot. You may reuse one model across different roles.", "warning");
    button.disabled = true;
    return false;
  }
  if (duplicatePair) {
    DAO_UI.setStatus("selectionStatus", "The same model cannot repeat the same role. Change the role or choose another model in the duplicated slot.", "error");
    button.disabled = true;
    return false;
  }

  const labels = reviewers.map(item => `${modelLabel(item.model)} (${reviewerProfiles().find(profile => profile.id === item.profileId)?.label || item.profileId})`);
  DAO_UI.setStatus("selectionStatus", `Review panel ready: ${labels.join(" · ")}. Reusing a model does not provide independent model diversity.`, "success");
  button.disabled = false;
  return true;
}

function shortFingerprint(value) {
  const text = String(value || "");
  if (!text) return "No fingerprint";
  if (text.length <= 20) return text;
  return `${text.slice(0, 10)}…${text.slice(-7)}`;
}

function renderProposalContext(proposal) {
  DAO_UI.showJson("proposalPreview", proposal);
  const badge = document.getElementById("proposalFingerprint");
  const summary = document.getElementById("proposalSummary");

  if (!proposal) {
    badge.textContent = "No proposal";
    summary.textContent = "Generate a proposal first.";
    return;
  }

  badge.textContent = shortFingerprint(proposal.fingerprint);
  const actions = Array.isArray(proposal.actions) ? proposal.actions.length : 0;
  const targets = Array.isArray(proposal.targets) ? proposal.targets.length : 0;
  summary.textContent = `${actions} semantic action(s) · ${targets} encoded target(s) · ${proposal.description || "No description"}`;
}

function renderFinding(finding) {
  const div = el("div", `finding ${String(finding.severity || "INFO").toUpperCase()}`);
  div.append(
    el("strong", "", `${finding.severity || "INFO"} · ${finding.category || "general"}`),
    el("div", "", finding.message || "")
  );
  if (finding.suggestion) {
    div.append(el("div", "muted small", `Suggested action: ${finding.suggestion}`));
  }
  return div;
}

function reviewerRevisionButton(review, session) {
  if (!review.revisedNaturalLanguage || review.verdict === "APPROVE") return null;
  const button = el("button", "btn", "Use this revision in compiler");
  button.type = "button";
  button.onclick = () => sendRevisionToCompiler(
    review.revisedNaturalLanguage,
    session,
    {
      source: "reviewer",
      reviewerId: review.reviewerId,
      model: review.model,
      profileId: review.profile?.id || null
    }
  );
  return button;
}

function renderReviewerResults(session) {
  const root = document.getElementById("reviewerResults");
  root.innerHTML = "";

  if (!session?.reviews?.length) {
    root.append(el("div", "empty-state", "No reviewer reports yet."));
    return;
  }

  for (const review of session.reviews) {
    const card = el("article", "reviewer-report-card");

    const header = el("div", "reviewer-report-header");
    const identity = el("div");
    identity.append(
      el("div", "reviewer-result-name", `${review.reviewerId.replace("reviewer-", "Reviewer ")} · ${modelLabel(review.model)}`),
      el("div", "muted small", review.profile?.label || "General Governance")
    );
    const verdictWrap = el("div", "reviewer-report-verdict");
    verdictWrap.innerHTML = DAO_UI.severityBadge(review.verdict);
    header.append(identity, verdictWrap);

    const confidenceValue = Math.round(Number(review.confidence || 0) * 100);
    const summaryRow = el("div", "reviewer-summary-row");
    const summaryBox = el("div", "review-summary-box");
    summaryBox.append(el("span", "metric-label", "Assigned review mission"),
      el("p", "", review.profile?.primaryMission || review.profile?.description || review.profile?.label || "General governance review"));
    summaryBox.append(el("span", "metric-label", "Role conclusion"),
      el("p", "", review.roleAssessment?.conclusion || "No separate role conclusion supplied by this AI reviewer."));
    summaryBox.append(el("span", "metric-label", "Work summary"),
      el("p", "", review.workSummary || "No summary returned."));
    const confidenceBox = el("div", "reviewer-confidence-box");
    confidenceBox.append(
      el("span", "metric-label", "Confidence"),
      el("strong", "reviewer-confidence-value", `${confidenceValue}%`)
    );
    summaryRow.append(summaryBox, confidenceBox);

    const detail = document.createElement("details");
    detail.className = "reviewer-details";
    if (review.verdict !== "APPROVE") detail.open = true;
    const detailSummary = document.createElement("summary");
    detailSummary.textContent = review.verdict === "APPROVE"
      ? "View findings and evidence notes"
      : "Review findings and recommended changes";
    detail.append(detailSummary);

    const detailBody = el("div", "reviewer-detail-body");
    const roleBox = el("div", "review-role-assessment");
    roleBox.append(el("h4", "", "Role-specific assessment"));
    if (review.roleAssessment?.conclusion) {
      roleBox.append(el("div", "muted small", `Focus: ${review.roleAssessment.focus || review.profile?.label || "Assigned review role"}`));
      roleBox.append(el("p", "", review.roleAssessment.conclusion));
      if (review.roleAssessment.decisionBasis) {
        roleBox.append(el("div", "muted small", `Decision basis: ${review.roleAssessment.decisionBasis.replace(/_/g, " ")}`));
      }
      if (review.roleAssessment.residualGovernanceRisk && review.roleAssessment.residualGovernanceRisk !== "NOT_ASSESSED") {
        roleBox.append(el("div", "muted small", `Residual governance risk: ${review.roleAssessment.residualGovernanceRisk}`));
      }
      if (review.roleAssessment.governanceRiskReason) {
        roleBox.append(el("p", "", `Governance risk reasoning: ${review.roleAssessment.governanceRiskReason}`));
      }
      if (review.roleAssessment.evidenceChecked?.length) {
        roleBox.append(el("strong", "muted small", "Evidence examined"));
        const evidenceList = el("ul", "adjustment-list");
        review.roleAssessment.evidenceChecked.forEach(item => evidenceList.append(el("li", "", item)));
        roleBox.append(evidenceList);
      }
      if (review.roleAssessment.uncertainty) roleBox.append(el("div", "muted small", `Evidence limit: ${review.roleAssessment.uncertainty}`));
    } else {
      roleBox.append(el("div", "muted small", "The model did not return a structured role-specific assessment. Review the model summary and findings; do not assume the role checks were completed."));
    }
    detailBody.append(roleBox);
    detailBody.append(el("h4", "", "Reviewer-specific findings"));
    const combinedFindings = review.findings || [];
    if (!combinedFindings.length) {
      detailBody.append(el("div", "empty-inline", "No additional reviewer-specific findings. Shared deterministic blockers are shown once above."));
    } else {
      combinedFindings.forEach(item => detailBody.append(renderFinding(item)));
    }

    detailBody.append(el("h4", "review-section-title", "Recommended adjustments"));
    if ((review.recommendedAdjustments || []).length) {
      const list = el("ul", "adjustment-list");
      review.recommendedAdjustments.forEach(item => list.append(el("li", "", item)));
      detailBody.append(list);
    } else {
      detailBody.append(el("div", "empty-inline", "No changes requested."));
    }

    if (review.revisedNaturalLanguage && review.verdict !== "APPROVE") {
      const revision = el("div", "revision-panel reviewer-revision");
      revision.append(el("h4", "", "Revised natural-language proposal"));
      const textarea = document.createElement("textarea");
      textarea.readOnly = true;
      textarea.value = review.revisedNaturalLanguage;
      revision.append(textarea);
      const actions = el("div", "actions");
      const button = reviewerRevisionButton(review, session);
      if (button) actions.append(button);
      revision.append(actions);
      detailBody.append(revision);
    }

    detail.append(detailBody);
    card.append(header, summaryRow, detail);
    root.append(card);
  }
}

function renderAggregateAdjustments(aggregate) {
  const root = document.getElementById("aggregateAdjustments");
  root.innerHTML = "";
  const adjustments = aggregate?.recommendedAdjustments || [];
  if (!adjustments.length) return;

  root.append(el("h3", "", "Recommended adjustments"));
  const list = el("ul", "adjustment-list");
  adjustments.forEach(item => list.append(el("li", "", item)));
  root.append(list);
}

function renderConsensus(session) {
  const empty = document.getElementById("consensusEmpty");
  const content = document.getElementById("consensusContent");
  const verdict = document.getElementById("aggregateVerdict");

  if (!session?.aggregate) {
    empty.hidden = false;
    content.hidden = true;
    verdict.innerHTML = "";
    return;
  }

  const aggregate = session.aggregate;
  empty.hidden = true;
  content.hidden = false;
  verdict.innerHTML = DAO_UI.severityBadge(aggregate.verdict);
  document.getElementById("agreementValue").textContent = String(aggregate.agreement || "—").replace(/_/g, " ");
  document.getElementById("reviewerCountValue").textContent = String(aggregate.reviewerCount || session.reviews?.length || 0);
  document.getElementById("nextActionValue").textContent = String(aggregate.nextAction || "—").replace(/_/g, " ");
  document.getElementById("consensusSummary").textContent = aggregate.summary || "";
  renderAggregateAdjustments(aggregate);

  const panel = document.getElementById("aggregateRevisionPanel");
  const textarea = document.getElementById("aggregateRevision");
  const recommendation = aggregate.recommendedRevision;
  if (recommendation?.revisedNaturalLanguage) {
    panel.hidden = false;
    textarea.value = recommendation.revisedNaturalLanguage;
  } else {
    panel.hidden = true;
    textarea.value = "";
  }
}

function renderCommonBlockers(session) {
  const root = document.getElementById("sharedReviewBlockers");
  if (!root) return;
  root.replaceChildren();
  const blockers = (session?.sharedEvidence?.deterministic?.findings || [])
    .filter(item => ["HIGH", "CRITICAL"].includes(String(item.severity).toUpperCase()));
  if (!session || !blockers.length) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.append(el("h3", "", "Shared deterministic blockers — apply to every reviewer"));
  root.append(el("p", "muted small", "These machine-derived blockers are common evidence, not separate conclusions independently discovered by each AI reviewer."));
  blockers.forEach(item => root.append(renderFinding(item)));
}

function renderSession(session) {
  renderCommonBlockers(session);
  renderConsensus(session);
  renderReviewerResults(session);
  DAO_UI.showJson("evidenceOutput", session?.sharedEvidence || null);
  document.getElementById("roundBadge").textContent = `Round ${session?.loopState?.round || currentRound()}`;
}

function sendRevisionToCompiler(text, session, source) {
  const value = String(text || "").trim();
  if (!value) return;

  const current = DAO_STATE.load();
  const nextRound = Number(session?.loopState?.nextSuggestedRound || (session?.loopState?.round || 1) + 1);
  DAO_STATE.save({
    sourceText: value,
    proposal: null,
    analysis: null,
    analysisFingerprint: null,
    review: null,
    reviewSession: null,
    validation: null,
    humanEditContext: null,
    humanConfirmation: null,
    submission: null,
    iterationContext: {
      protocolVersion: session?.loopState?.protocolVersion || "yanfu-review-loop-v1",
      parentReviewSessionId: session?.sessionId || null,
      previousProposalFingerprint: session?.proposalFingerprint || null,
      previousRound: session?.loopState?.round || 1,
      requestedRound: nextRound,
      requestedReviewRound: nextRound,
      revisionSource: source,
      createdAt: new Date().toISOString()
    },
    reviewHistory: current.reviewHistory || []
  });

  window.location.href = "generate.html";
}

function saveReviewSession(session) {
  const current = DAO_STATE.load();
  const history = [...(current.reviewHistory || []), session].slice(-20);
  DAO_STATE.save({
    reviewSession: session,
    review: session.aggregate,
    reviewHistory: history,
    humanEditContext: null,
    humanConfirmation: null
  });
}

function updateHumanConfirmLink() {
  const state = DAO_STATE.load();
  const currentReviewed = Boolean(
    state.proposal?.fingerprint &&
    state.reviewSession?.proposalFingerprint === state.proposal.fingerprint &&
    Boolean(state.reviewSession?.attestation)
  );
  DAO_NAV.applyLinkGate(
    document.getElementById("continueHumanBtn"),
    currentReviewed,
    "Run the AI Review Panel on the current proposal before entering Human Confirm."
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await DAO_NAV.guardPage("review"))) return;

  DAO_NAV.renderNavigation("review");
  DAO_NAV.renderWorkflow("review");

  // Render local workflow state before any network calls. If model/config loading
  // fails, the page still explains which proposal was supposed to be reviewed.
  let state = DAO_STATE.load();
  renderProposalContext(state.proposal);
  renderSession(state.reviewSession);
  updateHumanConfirmLink();

  const workflowNotice = DAO_NAV.consumeWorkflowNotice();
  DAO_UI.setStatus(
    "selectionStatus",
    workflowNotice || "Loading reviewer models and review profiles…",
    workflowNotice ? "warning" : ""
  );

  await DAO_UI.refreshChainSummary();

  try {
    [publicConfig, modelCatalog] = await Promise.all([
      DAO_API.get("/api/config/public"),
      DAO_MODELS.getCatalog(true)
    ]);
  } catch (error) {
    document.getElementById("reviewBtn").disabled = true;
    DAO_UI.setStatus(
      "selectionStatus",
      `Reviewer setup could not load: ${error.message}. Refresh after confirming /api/models and /api/config/public are available.`,
      "error"
    );
    DAO_UI.setStatus("reviewStatus", "Review panel initialization failed before model selection was available.", "error");
    return;
  }

  const available = DAO_MODELS.availableModels(modelCatalog);
  if (!available.length) {
    document.getElementById("reviewBtn").disabled = true;
    DAO_UI.setStatus("selectionStatus", "No AI reviewer model is currently available. Check /api/models and provider credentials.", "error");
    return;
  }

  const maxCount = Math.max(1, Number(publicConfig?.reviewers?.limits?.maxReviewers || 5));
  const countSelect = document.getElementById("reviewerCount");
  [...countSelect.options].forEach(option => { option.disabled = Number(option.value) > maxCount; });
  const setup = getSetup();
  document.getElementById("reviewerCount").value = String(setup.count);
  renderReviewerSlots();

  document.getElementById("reviewerCount").addEventListener("change", event => {
    const count = Number(event.target.value);
    const current = DAO_STATE.load();
    const reviewers = [...(current.reviewSetup?.reviewers || [])];
    while (reviewers.length < count) reviewers.push(defaultReviewer(reviewers.length));
    DAO_STATE.save({ reviewSetup: { count, reviewers: reviewers.slice(0, count) } });
    renderReviewerSlots();
  });

  document.getElementById("useAggregateRevision").onclick = () => {
    const current = DAO_STATE.load();
    const session = current.reviewSession;
    const revision = session?.aggregate?.recommendedRevision?.revisedNaturalLanguage;
    if (!revision) return;
    sendRevisionToCompiler(revision, session, {
      source: "aggregate-recommendation",
      reviewerId: session.aggregate.recommendedRevision.reviewerId,
      model: session.aggregate.recommendedRevision.model,
      profileId: session.aggregate.recommendedRevision.profile?.id || null
    });
  };

  document.getElementById("reviewBtn").onclick = async () => {
    const current = DAO_STATE.load();
    if (!current.proposal || !current.analysis) {
      DAO_UI.setStatus("reviewStatus", "Compile and Analyze must both be completed before AI Review.", "warning");
      return;
    }
    if (!validateSelection()) return;

    const reviewers = collectReviewerSpecs();
    persistSetupFromUi();
    DAO_UI.setStatus("reviewStatus", `Running ${reviewers.length} independent reviewer(s)…`);
    document.getElementById("reviewBtn").disabled = true;

    try {
      const round = currentRound();
      const response = await DAO_API.post("/api/review/session", {
        proposal: current.proposal,
        analysis: current.analysis,
        reviewers,
        models: reviewers.map(item => item.model),
        roundContext: {
          round,
          parentSessionId: current.iterationContext?.parentReviewSessionId || null,
          sourceIteration: current.iterationContext || null
        },
        iteration: round
      });

      saveReviewSession(response.reviewSession);
      renderSession(response.reviewSession);
      updateHumanConfirmLink();
      DAO_UI.setStatus(
        "reviewStatus",
        `Review round ${response.reviewSession.loopState?.round || round} completed: ${response.reviewSession.aggregate.verdict}. Human Confirm is now available.`,
        response.reviewSession.aggregate.verdict === "APPROVE" ? "success" : "warning"
      );
      DAO_NAV.renderWorkflow("review");
      DAO_NAV.renderNavigation("review");
    } catch (error) {
      DAO_UI.setStatus("reviewStatus", error.message, "error");
    } finally {
      validateSelection();
    }
  };
});
