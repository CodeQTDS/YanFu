"use strict";

let capabilityMap = new Map();
let chainConfig = null;
let appConfig = null;

function parseArrayInput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\n|,/).map(item => item.trim()).filter(Boolean);
}

function inputValueFor(value) {
  return Array.isArray(value) ? JSON.stringify(value, null, 2) : String(value ?? "");
}

function renderActionEditors(proposal) {
  const root = document.getElementById("actionEditors");
  root.innerHTML = "";

  (proposal?.actions || []).forEach((action, actionIndex) => {
    const card = document.createElement("div");
    card.className = "action-editor";

    const title = document.createElement("h3");
    title.textContent = `Action ${actionIndex + 1}: ${action.capabilityId}`;
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "argument-grid";

    for (const [name, value] of Object.entries(action.arguments || {})) {
      const field = document.createElement("div");
      field.className = "field";

      const label = document.createElement("label");
      label.textContent = name;

      const isArray = Array.isArray(value);
      const input = isArray ? document.createElement("textarea") : document.createElement("input");
      input.dataset.actionIndex = String(actionIndex);
      input.dataset.argument = name;
      input.dataset.isArray = isArray ? "true" : "false";
      input.value = inputValueFor(value);
      if (isArray) input.style.minHeight = "95px";

      field.append(label, input);
      grid.appendChild(field);
    }

    card.appendChild(grid);
    root.appendChild(card);
  });
}

function collectEditedActions(proposal) {
  return (proposal.actions || []).map(action => ({
    capabilityId: action.capabilityId,
    arguments: { ...(action.arguments || {}) }
  })).map((action, actionIndex) => {
    const inputs = document.querySelectorAll(`[data-action-index="${actionIndex}"]`);
    for (const input of inputs) {
      action.arguments[input.dataset.argument] = input.dataset.isArray === "true"
        ? parseArrayInput(input.value)
        : input.value;
    }
    return action;
  });
}

function parseGovernorJsonArray(id, label) {
  const raw = document.getElementById(id)?.value || "";
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return value;
}

function renderGovernorOverrideEditor(proposal) {
  const targets = document.getElementById("governorTargetsInput");
  const values = document.getElementById("governorValuesInput");
  const calldatas = document.getElementById("governorCalldatasInput");
  if (!targets || !values || !calldatas) return;

  targets.value = JSON.stringify(proposal?.targets || [], null, 2);
  values.value = JSON.stringify(proposal?.values || [], null, 2);
  calldatas.value = JSON.stringify(proposal?.calldatas || [], null, 2);
}

function collectGovernorOverride(proposal) {
  return {
    proposal,
    description: document.getElementById("descriptionInput")?.value.trim() || "",
    targets: parseGovernorJsonArray("governorTargetsInput", "targets[]"),
    values: parseGovernorJsonArray("governorValuesInput", "values[]"),
    calldatas: parseGovernorJsonArray("governorCalldatasInput", "calldatas[]")
  };
}

async function loadPublicConfig() {
  const response = await DAO_API.get("/api/config/public");
  chainConfig = response.chain;
  appConfig = response.app;

  capabilityMap = new Map(
    (response.proposalElements?.capabilities || []).map(item => [item.id, item])
  );

  return response;
}

function reviewMatchesProposal(state) {
  return Boolean(
    state.proposal?.fingerprint &&
    state.reviewSession?.proposalFingerprint === state.proposal.fingerprint &&
    Boolean(state.reviewSession?.attestation) &&
    (!state.proposal?.metadata?.sourceText || state.proposal?.sourceText === state.proposal.metadata.sourceText)
  );
}

function validationMatchesProposal(state) {
  return Boolean(
    state.validation?.valid &&
    Date.now() - Date.parse(state.validation.validatedAt || "") <= VALIDATION_MAX_AGE_MS &&
    state.proposal?.fingerprint &&
    state.validation?.fingerprint === state.proposal.fingerprint
  );
}

function humanEditOverrideConfig() {
  return appConfig?.workflow?.humanEditOverride || {};
}

function reviewResultOverrideConfig() {
  return appConfig?.workflow?.reviewResultOverride || {};
}

function hasPriorReviewedFingerprint(state) {
  const context = state.humanEditContext;
  if (!context?.priorReviewSessionId || !context?.priorReviewedFingerprint) return false;
  if (!state.proposal?.fingerprint) return false;
  return context.priorReviewedFingerprint !== state.proposal.fingerprint;
}

function sameFingerprintReviewOverrideSatisfied(state) {
  const workflow = appConfig?.workflow || {};
  const config = reviewResultOverrideConfig();
  const session = state.reviewSession;

  if (!session || !reviewMatchesProposal(state)) return false;
  if (session.aggregate?.verdict === "APPROVE") return true;
  if (!workflow.allowHumanReviewOverride || config.enabled === false) return false;

  const overrideChecked = document.getElementById("overrideReviewCheckbox")?.checked;
  if (config.requireAcknowledgement !== false && !overrideChecked) return false;

  if (config.requireWrittenReason === true) {
    const reason = document.getElementById("overrideReason")?.value.trim() || "";
    const minimum = Number(config.minimumReasonLength || 10);
    if (reason.length < minimum) return false;
  }

  return true;
}

function humanEditNoRereviewOverrideSatisfied(state) {
  const config = humanEditOverrideConfig();

  if (!config.enabled) return false;
  if (reviewMatchesProposal(state)) return false;
  if (config.requirePreviousReviewSession !== false && !hasPriorReviewedFingerprint(state)) return false;
  if (config.requireFreshValidation !== false && !validationMatchesProposal(state)) return false;

  const acknowledged = document.getElementById("humanEditRiskCheckbox")?.checked;
  if (config.requireRiskAcknowledgement !== false && !acknowledged) return false;

  if (config.requireWrittenReason === true) {
    const reason = document.getElementById("humanEditRiskReason")?.value.trim() || "";
    const minimum = Number(config.minimumReasonLength || 10);
    if (reason.length < minimum) return false;
  }

  return true;
}

function renderReviewGate() {
  const state = DAO_STATE.load();
  const session = state.reviewSession;

  const summary = document.getElementById("reviewGateSummary");
  const reports = document.getElementById("reviewGateReports");
  const overridePanel = document.getElementById("overridePanel");
  const humanEditRiskPanel = document.getElementById("humanEditRiskPanel");

  const overrideAllowed = Boolean(appConfig?.workflow?.allowHumanReviewOverride);
  const editOverride = humanEditOverrideConfig();

  reports.innerHTML = "";
  overridePanel.hidden = true;
  humanEditRiskPanel.hidden = true;

  const riskStatement = document.getElementById("humanEditRiskStatement");
  if (riskStatement) {
    riskStatement.textContent = editOverride.riskStatement || "";
  }

  if (!session) {
    summary.innerHTML = `${DAO_UI.severityBadge("NEEDS_CHANGES")}<p>No AI review session exists. Complete an AI review before submission.</p>`;
    return;
  }

  const current = reviewMatchesProposal(state);
  const aggregate = session.aggregate || {};

  // AI aggregates are untrusted prose: only the controlled badge may use HTML.
  summary.innerHTML = DAO_UI.severityBadge(aggregate.verdict);
  const aggregateSummary = document.createElement("p");
  aggregateSummary.textContent = aggregate.summary || "Review completed.";
  const sessionInfo = document.createElement("div");
  sessionInfo.className = "muted small";
  sessionInfo.textContent = `Agreement: ${String(aggregate.agreement || "—").replace(/_/g, " ")} · Session: ${session.sessionId || "—"}`;
  const fingerprintInfo = document.createElement("div");
  fingerprintInfo.className = "muted small";
  fingerprintInfo.textContent = `Fingerprint: ${current ? "matches current proposal" : "STALE — the proposal was changed after this AI review"}`;
  summary.append(aggregateSummary, sessionInfo, fingerprintInfo);

  for (const review of session.reviews || []) {
    const row = document.createElement("div");
    row.className = "finding";
    row.innerHTML = `<strong>Reviewer report</strong>
      <div>${DAO_UI.severityBadge(review.verdict)}</div>
      </div>`;
    const narrative = document.createElement("div");
    narrative.className = "muted small";
    narrative.textContent = `${review.profile?.label || "General"}: ${review.workSummary || "No summary"}`;
    row.appendChild(narrative);
    const info = document.createElement("div");
    info.className = "muted small";
    info.textContent = `${review.reviewerId || "Reviewer"} · ${review.model || "model"}`;
    row.prepend(info);
    reports.appendChild(row);
  }

  if (current) {
    const approved = aggregate.verdict === "APPROVE";
    overridePanel.hidden = approved || !overrideAllowed;
    const reviewRisk = document.getElementById("reviewOverrideRiskStatement");
    if (reviewRisk) {
      reviewRisk.textContent = reviewResultOverrideConfig().riskStatement ||
        "The AI review panel did not approve this exact fingerprint. Human authority may still proceed after explicit acknowledgement.";
    }
    return;
  }

  if (editOverride.enabled && hasPriorReviewedFingerprint(state)) {
    humanEditRiskPanel.hidden = false;
  }
}

function reviewGateSatisfied(state) {
  const workflow = appConfig?.workflow || {};

  if (!workflow.requireReviewBeforeSubmit) return true;

  const session = state.reviewSession;
  if (!session?.attestation) return false;

  if (reviewMatchesProposal(state)) {
    if (!workflow.requireApprovedReviewForSubmit) return true;
    if (session.aggregate?.verdict === "APPROVE") return true;
    return sameFingerprintReviewOverrideSatisfied(state);
  }

  return humanEditNoRereviewOverrideSatisfied(state);
}

function proposalWasHumanRewritten(state) {
  // Both deterministic semantic rebuilds and raw Governor overrides are human authority.
  // AI re-review does not erase the fact that this payload was changed by a person.
  return Boolean(state.proposal?.metadata?.editedBy === "HUMAN" ||
    state.proposal?.metadata?.humanGovernorOverride === true);
}

function humanRewriteConfirmationSatisfied(state) {
  return !proposalWasHumanRewritten(state) ||
    Boolean(document.getElementById("humanRewriteConfirmCheckbox")?.checked);
}

function confirmationSatisfied(state) {
  const checked = document.getElementById("humanConfirmCheckbox")?.checked;
  return Boolean(checked && state.proposal?.fingerprint && humanRewriteConfirmationSatisfied(state));
}

function currentSubmissionPath(state) {
  if (reviewMatchesProposal(state)) {
    if (state.reviewSession?.aggregate?.verdict === "APPROVE") {
      return "AI_REVIEWED_HUMAN_CONFIRMED";
    }

    return sameFingerprintReviewOverrideSatisfied(state)
      ? "HUMAN_REVIEW_RESULT_OVERRIDE"
      : "BLOCKED";
  }

  if (!humanEditNoRereviewOverrideSatisfied(state)) return "BLOCKED";

  return state.proposal?.metadata?.humanGovernorOverride
    ? "HUMAN_FINAL_GOVERNOR_OVERRIDE"
    : "HUMAN_EDIT_NO_REREVIEW_OVERRIDE";
}

function updateSubmitButton() {
  const state = DAO_STATE.load();
  const button = document.getElementById("submitBtn");

  const valid = validationMatchesProposal(state);
  const reviewOk = reviewGateSatisfied(state);
  const humanOk = confirmationSatisfied(state);
  const rewriteRequired = proposalWasHumanRewritten(state);
  const rewriteAcknowledged = humanRewriteConfirmationSatisfied(state);
  const rewritePanel = document.getElementById("humanRewriteConfirmPanel");
  if (rewritePanel) rewritePanel.hidden = !rewriteRequired;
  const rewriteCheckbox = document.getElementById("humanRewriteConfirmCheckbox");
  if (rewriteCheckbox) rewriteCheckbox.disabled = !valid || editorDirty || submissionInProgress;
  const finalCheckbox = document.getElementById("humanConfirmCheckbox");
  if (finalCheckbox) finalCheckbox.disabled = !valid || editorDirty || submissionInProgress;

  button.disabled = submissionInProgress || editorDirty || !(valid && reviewOk && humanOk);

  const path = currentSubmissionPath(state);
  const parts = [
    valid ? "✓ fresh validation" : "✗ validation required",
    reviewOk ? `✓ review gate (${path})` : "✗ review gate",
    rewriteRequired ? (rewriteAcknowledged ? "✓ human rewrite acknowledged" : "✗ human rewrite confirmation required") : "✓ unchanged proposal",
    humanOk ? "✓ final human confirmation" : "✗ human confirmation"
  ];

  DAO_UI.setStatus(
    "submitGateStatus",
    parts.join(" · "),
    !editorDirty && valid && reviewOk && humanOk ? "success" : "warning"
  );
}

function persistHumanConfirmation() {
  const state = DAO_STATE.load();

  const confirmed = Boolean(document.getElementById("humanConfirmCheckbox")?.checked);
  const reviewResultOverride = Boolean(document.getElementById("overrideReviewCheckbox")?.checked);
  const reviewResultOverrideReason = document.getElementById("overrideReason")?.value.trim() || "";

  const humanRewriteAcknowledgement = Boolean(document.getElementById("humanRewriteConfirmCheckbox")?.checked);
  const humanEditNoRereviewOverride = Boolean(document.getElementById("humanEditRiskCheckbox")?.checked);
  const humanEditRiskReason = document.getElementById("humanEditRiskReason")?.value.trim() || "";

  DAO_STATE.save({
    humanConfirmation: confirmed && state.proposal
      ? {
          confirmed: true,
          humanRewriteAcknowledgement: proposalWasHumanRewritten(state) ? humanRewriteAcknowledgement : false,
          humanRewritten: proposalWasHumanRewritten(state),
          confirmedAt: new Date().toISOString(),
          proposalFingerprint: state.proposal.fingerprint,
          reviewSessionId: state.reviewSession?.sessionId || null,
          reviewVerdict: state.reviewSession?.aggregate?.verdict || null,
          submissionPath: currentSubmissionPath(state),
          reviewResultOverride,
          reviewResultOverrideReason: reviewResultOverride ? reviewResultOverrideReason : "",
          humanEditNoRereviewOverride,
          humanEditRiskReason: humanEditNoRereviewOverride ? humanEditRiskReason : "",
          priorReviewedFingerprint: state.humanEditContext?.priorReviewedFingerprint || null
        }
      : null
  });

  DAO_NAV.renderWorkflow("editor");
  updateSubmitButton();
}

function invalidateDownstreamAfterEdit(oldState, proposal) {
  const priorSession = oldState.reviewSession || null;

  DAO_STATE.save({
    proposal,
    validation: null,
    analysis: null,
    analysisFingerprint: null,
    review: null,

    // Preserve the old review as stale lineage/evidence.
    // It is NOT approval of the new fingerprint.
    reviewSession: priorSession,

    humanEditContext: priorSession
      ? {
          editedAt: new Date().toISOString(),
          priorReviewSessionId: priorSession.sessionId || null,
          priorReviewedFingerprint: priorSession.proposalFingerprint || null,
          priorReviewVerdict: priorSession.aggregate?.verdict || null,
          currentFingerprint: proposal?.fingerprint || null,
          editMode: proposal?.metadata?.humanGovernorOverride
            ? "FINAL_GOVERNOR_OVERRIDE"
            : "SEMANTIC_REBUILD"
        }
      : null,

    humanConfirmation: null,
    submission: null
  });
}

function resetConfirmationInputs() {
  [
    "humanConfirmCheckbox",
    "humanRewriteConfirmCheckbox",
    "overrideReviewCheckbox",
    "humanEditRiskCheckbox"
  ].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.checked = false;
  });

  ["overrideReason", "humanEditRiskReason"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
}

let editorDirty = false;
let submissionInProgress = false;
const VALIDATION_MAX_AGE_MS = 30000;
let editorMode = "guided";
function humanRewriteIsEnabled() {
  return Boolean(document.getElementById("humanRewriteSwitch")?.checked);
}
function setHumanRewriteEnabled(enabled) {
  const toggle = document.getElementById("humanRewriteSwitch");
  if (submissionInProgress) {
    toggle.checked = !enabled;
    return false;
  }
  if (enabled && !DAO_STATE.load().proposal) {
    toggle.checked = false;
    DAO_UI.setStatus("editorStatus", "Generate a proposal before enabling Human rewriting.", "warning");
    return false;
  }
  if (!enabled && editorDirty && !confirm("Discard the unapplied rewrite? Validation will still need to be repeated.")) {
    toggle.checked = true;
    return false;
  }
  toggle.checked = enabled;
  toggle.setAttribute("aria-expanded", String(enabled));
  document.getElementById("humanRewritePanel").hidden = !enabled;
  if (!enabled) {
    const applied = DAO_STATE.load().proposal;
    if (applied) refreshAppliedEditors(applied);
  }
  return true;
}
function setEditorMode(mode) {
  if (!humanRewriteIsEnabled()) return;
  if (!["guided", "exact"].includes(mode)) return;
  if (mode === editorMode) return;
  if (editorDirty && !confirm("Discard unapplied edits and switch rewriting methods?")) {
    document.getElementById(mode === "guided" ? "humanRewriteExact" : "humanRewriteGuided").checked = true;
    return;
  }
  const applied = DAO_STATE.load().proposal;
  if (applied) refreshAppliedEditors(applied);
  editorMode = mode;
  document.getElementById("guidedEditorPanel").hidden = mode !== "guided";
  document.getElementById("finalGovernorOverridePanel").hidden = mode !== "exact";
  document.getElementById("humanRewriteGuided").checked = mode === "guided";
  document.getElementById("humanRewriteExact").checked = mode === "exact";
  markEditorDirty(false);
}
function allowRewrite(method) {
  if (!humanRewriteIsEnabled() || editorMode !== method) {
    DAO_UI.setStatus("editorStatus", "Enable Human rewriting and choose the correct rewrite method before applying changes.", "warning");
    return false;
  }
  return true;
}
function noRewriteChange(previous, updated) {
  if (updated.fingerprint !== previous.fingerprint) return false;
  refreshAppliedEditors(previous);
  setHumanRewriteEnabled(false);
  DAO_UI.setStatus("editorStatus", "No executable or description change detected. The current review and validation remain linked to this proposal.", "success");
  return true;
}
function markEditorDirty(dirty = true) {
  editorDirty = dirty;
  const warning = document.getElementById("pendingEditWarning");
  if (warning) warning.hidden = !dirty;
  const validate = document.getElementById("validateBtn");
  if (validate) validate.disabled = dirty;
  if (dirty) {
    DAO_STATE.save({ validation: null, humanConfirmation: null });
    resetConfirmationInputs();
  }
  if (typeof updateSubmitButton === "function") updateSubmitButton();
}
function refreshAppliedEditors(proposal) {
  document.getElementById("descriptionInput").value = proposal.description || "";
  renderActionEditors(proposal);
  renderGovernorOverrideEditor(proposal);
  document.getElementById("advancedActionsInput").value = JSON.stringify(
    (proposal.actions || []).map(action => ({ capabilityId: action.capabilityId, arguments: action.arguments || {} })), null, 2);
  markEditorDirty(false);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await DAO_NAV.guardPage("editor"))) return;

  DAO_NAV.renderNavigation("editor");
  DAO_NAV.renderWorkflow("editor");

  await loadPublicConfig();
  await DAO_UI.refreshChainSummary();

  let state = DAO_STATE.load();
  // The encoded payload is always visible; editing requires explicit checkbox opt-in.
  const rewriteToggle = document.getElementById("humanRewriteSwitch");
  rewriteToggle.checked = false;
  document.getElementById("humanRewritePanel").hidden = true;
  document.getElementById("humanRewriteGuided").onchange = () => setEditorMode("guided");
  document.getElementById("humanRewriteExact").onchange = () => setEditorMode("exact");
  rewriteToggle.onchange = () => setHumanRewriteEnabled(rewriteToggle.checked);
  document.getElementById("cancelHumanRewriteBtn").onclick = () => setHumanRewriteEnabled(false);
  editorMode = state.proposal?.metadata?.humanGovernorOverride ? "exact" : "guided";
  document.getElementById("guidedEditorPanel").hidden = editorMode !== "guided";
  document.getElementById("finalGovernorOverridePanel").hidden = editorMode !== "exact";
  document.getElementById("humanRewriteGuided").checked = editorMode === "guided";
  document.getElementById("humanRewriteExact").checked = editorMode === "exact";
  const editorRoot = document.getElementById("humanRewritePanel");
  editorRoot.addEventListener("input", event => {
    if (humanRewriteIsEnabled() && event.target.matches("#descriptionInput, #actionEditors input, #actionEditors textarea, #advancedActionsInput, #governorTargetsInput, #governorValuesInput, #governorCalldatasInput")) markEditorDirty(true);
  });

  if (state.proposal) {
    document.getElementById("descriptionInput").value = state.proposal.description || "";
    renderActionEditors(state.proposal);
    renderGovernorOverrideEditor(state.proposal);

    document.getElementById("advancedActionsInput").value = JSON.stringify(
      (state.proposal.actions || []).map(action => ({
        capabilityId: action.capabilityId,
        arguments: action.arguments || {}
      })),
      null,
      2
    );

    DAO_UI.showJson("encodedPreview", {
      targets: state.proposal.targets,
      values: state.proposal.values,
      calldatas: state.proposal.calldatas,
      fingerprint: state.proposal.fingerprint
    });
  }

  DAO_UI.showJson("validationOutput", state.validation);
  renderReviewGate();

  const existingConfirmation = state.humanConfirmation;
  if (existingConfirmation?.proposalFingerprint === state.proposal?.fingerprint && validationMatchesProposal(state)) {
    document.getElementById("humanConfirmCheckbox").checked = Boolean(existingConfirmation.confirmed);
    document.getElementById("humanRewriteConfirmCheckbox").checked = Boolean(existingConfirmation.humanRewriteAcknowledgement);
    document.getElementById("overrideReviewCheckbox").checked = Boolean(existingConfirmation.reviewResultOverride);
    document.getElementById("overrideReason").value = existingConfirmation.reviewResultOverrideReason || "";
    document.getElementById("humanEditRiskCheckbox").checked = Boolean(existingConfirmation.humanEditNoRereviewOverride);
    document.getElementById("humanEditRiskReason").value = existingConfirmation.humanEditRiskReason || "";
  }

  [
    "humanConfirmCheckbox",
    "humanRewriteConfirmCheckbox",
    "overrideReviewCheckbox",
    "humanEditRiskCheckbox"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", persistHumanConfirmation);
  });

  ["overrideReason", "humanEditRiskReason"].forEach(id => {
    document.getElementById(id).addEventListener("input", persistHumanConfirmation);
  });

  updateSubmitButton();

  document.getElementById("rebuildBtn").onclick = async () => {
    if (!allowRewrite("guided")) return;
    state = DAO_STATE.load();

    if (!state.proposal) {
      DAO_UI.setStatus("editorStatus", "Generate a proposal first.", "warning");
      return;
    }

    try {
      const actions = collectEditedActions(state.proposal);
      const description = document.getElementById("descriptionInput").value.trim();

      DAO_UI.setStatus("editorStatus", "Rebuilding calldata from edited semantic actions…");

      const response = await DAO_API.post("/api/proposal/rebuild", {
        proposal: state.proposal,
        actions,
        description
      });

      if (noRewriteChange(state.proposal, response.proposal)) return;
      invalidateDownstreamAfterEdit(state, response.proposal);
      refreshAppliedEditors(response.proposal);
      setHumanRewriteEnabled(false);

      DAO_UI.showJson("encodedPreview", {
        targets: response.proposal.targets,
        values: response.proposal.values,
        calldatas: response.proposal.calldatas,
        fingerprint: response.proposal.fingerprint
      });

      resetConfirmationInputs();
      renderReviewGate();

      DAO_UI.setStatus(
        "editorStatus",
        state.reviewSession
          ? "Edited proposal rebuilt. The previous AI review is now stale. Re-review is recommended; alternatively, after fresh validation you may use the Human Edit Risk Override."
          : "Edited proposal rebuilt. No prior AI review exists, so AI review is still required before submission.",
        "warning"
      );

      updateSubmitButton();
    } catch (error) {
      DAO_UI.setStatus("editorStatus", error.message, "error");
    }
  };

  document.getElementById("rebuildAdvancedBtn").onclick = async () => {
    if (!allowRewrite("guided")) return;
    state = DAO_STATE.load();

    if (!state.proposal) {
      DAO_UI.setStatus("editorStatus", "Generate a proposal first.", "warning");
      return;
    }

    try {
      const actions = JSON.parse(document.getElementById("advancedActionsInput").value);
      if (!Array.isArray(actions)) throw new Error("Advanced actions JSON must be an array");

      const description = document.getElementById("descriptionInput").value.trim();

      DAO_UI.setStatus("editorStatus", "Validating and rebuilding advanced semantic actions…");

      const response = await DAO_API.post("/api/proposal/rebuild", {
        proposal: state.proposal,
        actions,
        description
      });

      if (noRewriteChange(state.proposal, response.proposal)) return;
      invalidateDownstreamAfterEdit(state, response.proposal);
      refreshAppliedEditors(response.proposal);
      setHumanRewriteEnabled(false);

      document.getElementById("advancedActionsInput").value = JSON.stringify(
        (response.proposal.actions || []).map(action => ({
          capabilityId: action.capabilityId,
          arguments: action.arguments || {}
        })),
        null,
        2
      );

      DAO_UI.showJson("encodedPreview", {
        targets: response.proposal.targets,
        values: response.proposal.values,
        calldatas: response.proposal.calldatas,
        fingerprint: response.proposal.fingerprint
      });

      resetConfirmationInputs();
      renderReviewGate();

      DAO_UI.setStatus(
        "editorStatus",
        state.reviewSession
          ? "Advanced semantic actions rebuilt. The prior AI review is stale. Re-review is recommended; a controlled human-risk override is available only after fresh validation."
          : "Advanced semantic actions rebuilt. AI review is required because no prior review exists.",
        "warning"
      );

      updateSubmitButton();
    } catch (error) {
      DAO_UI.setStatus("editorStatus", error.message, "error");
    }
  };

  document.getElementById("applyGovernorOverrideBtn").onclick = async () => {
    if (!allowRewrite("exact")) return;
    state = DAO_STATE.load();

    if (!state.proposal) {
      DAO_UI.setStatus("editorStatus", "Generate a proposal first.", "warning");
      return;
    }

    const warning = [
      "HUMAN AUTHORITY OVERRIDE",
      "You are about to replace the exact Governor.propose() payload.",
      "The semantic plan may no longer describe the final executable proposal.",
      "Any existing AI review will become stale for the new fingerprint.",
      "Continue?"
    ].join("\n\n");

    if (!confirm(warning)) return;

    try {
      const payload = collectGovernorOverride(state.proposal);
      DAO_UI.setStatus("editorStatus", "Applying exact human-authored Governor proposal…", "warning");

      const response = await DAO_API.post("/api/proposal/human-override", payload);
      if (noRewriteChange(state.proposal, response.proposal)) return;
      invalidateDownstreamAfterEdit(state, response.proposal);

      refreshAppliedEditors(response.proposal);
      setHumanRewriteEnabled(false);
      DAO_UI.showJson("encodedPreview", {
        targets: response.proposal.targets,
        values: response.proposal.values,
        calldatas: response.proposal.calldatas,
        description: response.proposal.description,
        fingerprint: response.proposal.fingerprint,
        authority: "HUMAN_FINAL_GOVERNOR_OVERRIDE"
      });

      resetConfirmationInputs();
      renderReviewGate();
      DAO_UI.showJson("validationOutput", null);

      DAO_UI.setStatus(
        "editorStatus",
        "Final Governor proposal overridden by human authority. The prior AI review is now stale. Run fresh validation. AI re-review is recommended but is not required if you accept the Human Edit Risk Override.",
        "warning"
      );

      DAO_NAV.renderWorkflow("editor");
      updateSubmitButton();
    } catch (error) {
      DAO_UI.setStatus("editorStatus", error.message, "error");
    }
  };

  document.getElementById("validateBtn").onclick = async () => {
    if (editorDirty) return;
    state = DAO_STATE.load();
    if (!state.proposal) return;

    DAO_UI.setStatus("editorStatus", "Validating proposal against fresh chain state…");

    try {
      const response = await DAO_API.post("/api/proposal/validate", {
        proposal: state.proposal
      });

      DAO_STATE.save({
        validation: response.validation,
        humanConfirmation: null
      });

      resetConfirmationInputs();
      DAO_UI.showJson("validationOutput", response.validation);

      const refreshed = DAO_STATE.load();
      const staleReview = refreshed.reviewSession && !reviewMatchesProposal(refreshed);

      DAO_UI.setStatus(
        "editorStatus",
        staleReview
          ? "Proposal passed fresh validation. The AI review is stale because the human changed the proposal. Re-review is recommended, or use the explicit Human Edit Risk Override."
          : "Proposal passed current-state validation. Complete the review gate and final human confirmation.",
        "success"
      );

      renderReviewGate();
      updateSubmitButton();
    } catch (error) {
      const validation = error.data?.validation || null;

      DAO_STATE.save({
        validation,
        humanConfirmation: null
      });

      resetConfirmationInputs();
      DAO_UI.showJson("validationOutput", validation || error.data || { error: error.message });
      DAO_UI.setStatus("editorStatus", error.message, "error");

      renderReviewGate();
      updateSubmitButton();
    }
  };

  document.getElementById("connectBtn").onclick = async () => {
    try {
      const wallet = await DAO_WALLET.connect();
      DAO_UI.setStatus(
        "walletStatus",
        `Connected ${wallet.address} on chain ${wallet.network.chainId}`,
        "success"
      );
    } catch (error) {
      DAO_UI.setStatus("walletStatus", error.message, "error");
    }
  };

  document.getElementById("submitBtn").onclick = async () => {
    if (editorDirty || submissionInProgress) return;
    state = DAO_STATE.load();

    if (
      editorDirty ||
      !validationMatchesProposal(state) ||
      !reviewGateSatisfied(state) ||
      !confirmationSatisfied(state)
    ) {
      DAO_UI.setStatus(
        "walletStatus",
        "Submission gate is incomplete. Fresh validation, the applicable review/override gate, and explicit human confirmation are required.",
        "warning"
      );
      return;
    }

    persistHumanConfirmation();
    state = DAO_STATE.load();
    if (!state.humanConfirmation?.confirmed ||
      (proposalWasHumanRewritten(state) && !state.humanConfirmation?.humanRewriteAcknowledgement)) {
      DAO_UI.setStatus("walletStatus", "Human rewriting requires two explicit confirmations after validation.", "warning");
      return;
    }

    const submissionPath = currentSubmissionPath(state);

    const confirmText = ["HUMAN_EDIT_NO_REREVIEW_OVERRIDE", "HUMAN_FINAL_GOVERNOR_OVERRIDE"].includes(submissionPath)
      ? "HIGH-RISK HUMAN AUTHORITY OVERRIDE: the current human-edited Governor proposal fingerprint has NOT been reviewed by the AI reviewer panel. Fresh deterministic validation passed, but semantic/policy/economic/security risks may remain. Submit this exact proposal to Governor?"
      : submissionPath === "HUMAN_REVIEW_RESULT_OVERRIDE"
        ? "HUMAN REVIEW-RESULT OVERRIDE: the AI review panel did not approve this exact fingerprint. You are exercising final human authority after fresh validation. Submit this exact proposal to Governor?"
        : "Final human confirmation: submit this exact validated proposal to the Governor contract? MetaMask will request a transaction signature.";

    if (!confirm(confirmText)) return;

    try {
      if (submissionInProgress) return;
      submissionInProgress = true;
      updateSubmitButton();
      DAO_UI.setStatus("walletStatus", "Checking current chain balances immediately before MetaMask…");
      const latest = await DAO_API.post("/api/proposal/validate", { proposal: state.proposal });
      if (!latest.validation?.valid || latest.validation.fingerprint !== state.proposal.fingerprint) {
        throw new Error("Final pre-submission validation did not approve this exact proposal. Submission blocked.");
      }
      DAO_STATE.save({ validation: latest.validation });
      // Server HMAC binds the original reviewed request, exact payload, chain,
      // reviewer verdict, and session ID. Browser storage alone is never proof.
      const receipt = await DAO_API.post("/api/review/verify", {
        proposal: state.proposal,
        reviewSession: state.reviewSession,
        humanEditContext: state.humanEditContext
      });
      if (!receipt.verification?.valid) throw new Error("Server could not attest AI review lineage");
      if (reviewMatchesProposal(state) !== receipt.verification.current) {
        throw new Error("Review receipt does not match the active submission path");
      }
      if (receipt.verification.verdict !== state.reviewSession?.aggregate?.verdict) {
        throw new Error("The locally displayed review verdict was changed");
      }
      // Check again after the asynchronous network call, before opening the wallet.
      // A changed proposal or withdrawn human confirmation must never be signed.
      const preWalletState = DAO_STATE.load();
      if (editorDirty || preWalletState.proposal?.fingerprint !== state.proposal.fingerprint ||
          !reviewGateSatisfied(preWalletState) || !confirmationSatisfied(preWalletState)) {
        throw new Error("The proposal or human confirmation changed during final validation; revalidate and confirm again.");
      }
      const result = await DAO_WALLET.submitProposal(state.proposal, chainConfig);

      DAO_STATE.save({
        submission: {
          ...result,
          submissionPath,
          humanConfirmation: state.humanConfirmation,
          reviewSessionId: state.reviewSession?.sessionId || null,
          reviewedFingerprint: state.reviewSession?.proposalFingerprint || null,
          submittedFingerprint: state.proposal?.fingerprint || null,
          humanEditContext: state.humanEditContext || null
        }
      });

      DAO_UI.showJson("submissionOutput", DAO_STATE.load().submission);

      DAO_UI.setStatus(
        "walletStatus",
        `Submitted proposal ${result.proposalId} via ${submissionPath}`,
        "success"
      );

      DAO_NAV.renderWorkflow("submit");
    } catch (error) {
      DAO_STATE.save({ validation: null, humanConfirmation: null });
      DAO_UI.setStatus("walletStatus", `Submission stopped: ${error.message}. Revalidate and reconfirm after correcting the problem.`, "error");
    } finally {
      submissionInProgress = false;
      updateSubmitButton();
    }
  };
});
