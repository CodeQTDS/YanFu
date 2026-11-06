"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  DAO_NAV.renderNavigation("home");
  DAO_NAV.renderWorkflow(null);
  const state = DAO_STATE.load();
  const access = DAO_NAV.stageAccess(state);

  document.getElementById("proposalState").textContent = state.proposal ? "Ready" : "Not generated";
  document.getElementById("analysisState").textContent = state.analysis ? state.analysis.risk || "Complete" : "Pending";
  document.getElementById("reviewState").textContent = state.reviewSession
    ? state.reviewSession.aggregate?.verdict || "Complete"
    : "Pending";
  document.getElementById("submitState").textContent = state.submission ? "Submitted" : "Not submitted";

  DAO_NAV.applyLinkGate(
    document.getElementById("dashboardAnalyzeLink"),
    access.analyze,
    "Compile a proposal first."
  );
  DAO_NAV.applyLinkGate(
    document.getElementById("dashboardReviewLink"),
    access.review,
    "Complete Analyze before AI Review."
  );
  DAO_NAV.applyLinkGate(
    document.getElementById("dashboardEditorLink"),
    access.editor,
    "Complete the AI Review Panel before Human Confirm."
  );

  const last = document.getElementById("lastUpdated");
  last.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "—";

  await DAO_UI.refreshChainSummary();

  document.getElementById("resetWorkflow").onclick = () => {
    if (confirm("Clear the current local workflow draft and review history?")) {
      DAO_STATE.clear();
      window.location.reload();
    }
  };
});
