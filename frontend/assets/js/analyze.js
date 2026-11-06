"use strict";

function updateAnalyzeNextStep() {
  const state = DAO_STATE.load();
  DAO_NAV.applyLinkGate(
    document.getElementById("continueReviewBtn"),
    Boolean(state.proposal && state.analysis),
    "Run analysis before opening the AI Review Panel."
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await DAO_NAV.guardPage("analyze"))) return;

  DAO_NAV.renderNavigation("analyze");
  DAO_NAV.renderWorkflow("analyze");

  const workflowNotice = DAO_NAV.consumeWorkflowNotice();
  if (workflowNotice) DAO_UI.setStatus("analysisStatus", workflowNotice, "warning");

  try {
    await DAO_MODELS.populateModelSelect("modelSelect", "analysis");
  } catch (error) {
    DAO_UI.setStatus("analysisStatus", `Could not load AI models: ${error.message}`, "error");
    document.getElementById("analyzeBtn").disabled = true;
  }

  await DAO_UI.refreshChainSummary();

  const state = DAO_STATE.load();
  DAO_UI.showJson("proposalPreview", state.proposal);
  DAO_UI.showJson("analysisOutput", state.analysis);
  updateAnalyzeNextStep();

  document.getElementById("analyzeBtn").onclick = async () => {
    const current = DAO_STATE.load();
    const model = document.getElementById("modelSelect").value;
    if (!current.proposal) {
      DAO_UI.setStatus("analysisStatus", "Generate a proposal first.", "warning");
      return;
    }
    if (!model) {
      DAO_UI.setStatus("analysisStatus", "Choose an available analysis model first.", "warning");
      return;
    }

    DAO_UI.setStatus("analysisStatus", "Reading chain state, simulating calls and running AI analysis…");
    try {
      const response = await DAO_API.post("/api/analyze", {
        proposal: current.proposal,
        model
      });
      DAO_STATE.save({
        analysis: response.analysis,
        analysisFingerprint: current.proposal.fingerprint || null,
        review: null,
        reviewSession: null,
        humanEditContext: null,
        humanConfirmation: null,
        submission: null,
        models: { ...current.models, analysis: model }
      });
      DAO_UI.showJson("analysisOutput", response.analysis);
      document.getElementById("riskBadge").innerHTML = DAO_UI.severityBadge(response.analysis.risk);
      DAO_UI.setStatus("analysisStatus", "Analysis completed. Continue to the AI Review Panel.", "success");
      DAO_NAV.renderWorkflow("analyze");
      DAO_NAV.renderNavigation("analyze");
      updateAnalyzeNextStep();
    } catch (error) {
      DAO_UI.setStatus("analysisStatus", error.message, "error");
    }
  };

  if (state.analysis?.risk) {
    document.getElementById("riskBadge").innerHTML = DAO_UI.severityBadge(state.analysis.risk);
  }
});
