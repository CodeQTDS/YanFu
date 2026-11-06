"use strict";

const DEFAULT_WORKFLOW_POLICY = {
  enforceSequentialStages: true,
  requireAnalysisBeforeReview: true,
  requireReviewBeforeSubmit: true
};

function proposalReady(state) {
  return Boolean(state?.proposal?.fingerprint);
}

function analysisReady(state) {
  return Boolean(proposalReady(state) && state?.analysis);
}

function currentReviewReady(state) {
  return Boolean(
    analysisReady(state) &&
    state?.reviewSession?.proposalFingerprint &&
    state.reviewSession.proposalFingerprint === state.proposal.fingerprint &&
    Boolean(state.reviewSession.attestation)
  );
}

function postEditReviewLineageReady(state) {
  return Boolean(
    state?.reviewSession?.sessionId &&
    state?.reviewSession?.attestation &&
    state?.humanEditContext?.priorReviewSessionId === state.reviewSession.sessionId
  );
}

function editorReady(state) {
  return currentReviewReady(state) || postEditReviewLineageReady(state);
}

function stageAccess(state = DAO_STATE.load()) {
  return {
    home: true,
    generate: true,
    analyze: proposalReady(state),
    review: analysisReady(state),
    editor: editorReady(state),
    submit: Boolean(state?.humanConfirmation)
  };
}

function renderNavigation(active) {
  const root = document.getElementById("appNav");
  if (!root) return;

  const state = DAO_STATE.load();
  const access = stageAccess(state);
  const inPages = window.location.pathname.includes("/pages/");
  const base = inPages ? "" : "pages/";
  const items = [
    ["home", "Dashboard", inPages ? "../index.html" : "index.html"],
    ["generate", "Generate", `${base}generate.html`],
    ["analyze", "Analyze", `${base}analyze.html`],
    ["review", "AI Review Team", `${base}review.html`],
    ["editor", "Confirm & Submit", `${base}editor.html`]
  ];

  root.innerHTML = items.map(([id, label, href]) => {
    const locked = id !== "home" && id !== "generate" && !access[id];
    return `<a class="${id === active ? "active" : ""} ${locked ? "locked" : ""}" ${locked ? `aria-disabled="true" title="Complete the previous workflow stage first"` : `href="${href}"`}>${label}${locked ? " · Locked" : ""}</a>`;
  }).join("");
}

function renderWorkflow(current) {
  const root = document.getElementById("workflowBar");
  if (!root) return;
  const state = DAO_STATE.load();
  const currentReview = currentReviewReady(state);
  const staleReview = postEditReviewLineageReady(state) && !currentReview;
  const stages = [
    ["generate", "1. Compile", proposalReady(state), null],
    ["analyze", "2. Analyze", analysisReady(state), null],
    ["review", "3. AI Review Panel", currentReview || staleReview, staleReview ? "Pre-edit review" : null],
    ["editor", "4. Human Confirm", Boolean(state.humanConfirmation), null],
    ["submit", "5. Submit", Boolean(state.submission), null]
  ];
  root.innerHTML = stages.map(([id, label, done, statusOverride]) =>
    `<div class="workflow-step ${done ? "done" : ""} ${id === current ? "current" : ""}"><strong>${label}</strong><span>${statusOverride || (done ? "Completed" : "Pending")}</span></div>`
  ).join("");
}

function redirectForStage(stage) {
  if (stage === "analyze") return "generate.html";
  if (stage === "review") return "analyze.html";
  if (stage === "editor") return "review.html";
  return "generate.html";
}

function reasonForStage(stage) {
  if (stage === "analyze") return "Generate a proposal before opening Analyze.";
  if (stage === "review") return "Complete proposal analysis before opening the AI Review Panel.";
  if (stage === "editor") return "Run the AI Review Panel before entering Human Confirm.";
  return "Complete the previous workflow stage first.";
}

async function workflowPolicy() {
  try {
    const response = await DAO_API.get("/api/config/public");
    return {
      ...DEFAULT_WORKFLOW_POLICY,
      ...(response?.app?.workflow || {})
    };
  } catch (_) {
    // Fail closed: if policy cannot be loaded, preserve the sequential safety path.
    return DEFAULT_WORKFLOW_POLICY;
  }
}

async function guardPage(stage) {
  const policy = await workflowPolicy();
  if (policy.enforceSequentialStages === false) return true;

  const state = DAO_STATE.load();
  let allowed = true;
  if (stage === "analyze") allowed = proposalReady(state);
  if (stage === "review" && policy.requireAnalysisBeforeReview !== false) allowed = analysisReady(state);
  if (stage === "editor" && policy.requireReviewBeforeSubmit !== false) allowed = editorReady(state);

  if (allowed) return true;

  sessionStorage.setItem("yanfuWorkflowNotice", reasonForStage(stage));
  window.location.replace(redirectForStage(stage));
  return false;
}

function consumeWorkflowNotice() {
  const message = sessionStorage.getItem("yanfuWorkflowNotice");
  if (message) sessionStorage.removeItem("yanfuWorkflowNotice");
  return message;
}

function applyLinkGate(element, allowed, message) {
  if (!element) return;
  if (allowed) {
    element.classList.remove("locked");
    element.removeAttribute("aria-disabled");
    element.removeAttribute("title");
    element.onclick = null;
    return;
  }
  element.classList.add("locked");
  element.setAttribute("aria-disabled", "true");
  element.title = message || "Complete the previous workflow stage first";
  element.onclick = event => event.preventDefault();
}

window.DAO_NAV = {
  renderNavigation,
  renderWorkflow,
  stageAccess,
  guardPage,
  consumeWorkflowNotice,
  applyLinkGate,
  currentReviewReady,
  editorReady
};
