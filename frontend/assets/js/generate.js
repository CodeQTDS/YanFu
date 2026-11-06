"use strict";

function renderIterationNotice(state) {
  const panel = document.getElementById("iterationNotice");
  const text = document.getElementById("iterationNoticeText");
  if (!panel || !text) return;

  if (!state.iterationContext) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const ctx = state.iterationContext;
  text.textContent = `This request came from review session ${ctx.parentReviewSessionId || "unknown"}. It is prepared for compiler/reviewer round ${ctx.requestedRound || "next"}. Review-loop execution remains manual in this version.`;
}

document.addEventListener("DOMContentLoaded", async () => {
  DAO_NAV.renderNavigation("generate");
  DAO_NAV.renderWorkflow("generate");

  const workflowNotice = DAO_NAV.consumeWorkflowNotice();
  if (workflowNotice) DAO_UI.setStatus("generateStatus", workflowNotice, "warning");
  await DAO_MODELS.populateModelSelect("modelSelect", "generation");
  await DAO_UI.refreshChainSummary();

  let state = DAO_STATE.load();
  document.getElementById("proposalText").value = state.sourceText || "";
  DAO_UI.showJson("proposalOutput", state.proposal);
  renderIterationNotice(state);

  document.getElementById("clearIterationBtn").onclick = () => {
    state = DAO_STATE.load();
    DAO_STATE.save({ iterationContext: null });
    renderIterationNotice(DAO_STATE.load());
    DAO_UI.setStatus("generateStatus", "Review-loop provenance cleared. The current text is now treated as a fresh request.", "success");
  };

  document.getElementById("generateBtn").onclick = async () => {
    state = DAO_STATE.load();
    const text = document.getElementById("proposalText").value.trim();
    const model = document.getElementById("modelSelect").value;
    if (!text) {
      DAO_UI.setStatus("generateStatus", "Enter a natural-language governance request first.", "warning");
      return;
    }

    DAO_UI.setStatus("generateStatus", "Generating and deterministically validating the proposal…");
    try {
      const response = await DAO_API.post("/api/generate", {
        text,
        model,
        iterationContext: state.iterationContext || null
      });
      const current = DAO_STATE.load();
      DAO_STATE.save({
        sourceText: text,
        proposal: response.proposal,
        analysis: null,
        analysisFingerprint: null,
        review: null,
        reviewSession: null,
        validation: null,
        humanEditContext: null,
        humanConfirmation: null,
        submission: null,
        models: { ...current.models, generation: model }
      });
      DAO_UI.showJson("proposalOutput", response.proposal);
      DAO_UI.setStatus("generateStatus", "Proposal generated successfully. Continue to Analyze. AI Review unlocks after analysis is complete.", "success");
      DAO_NAV.renderWorkflow("generate");
      DAO_NAV.renderNavigation("generate");
    } catch (error) {
      const inputValidation = error.data?.inputValidation;
      if (inputValidation && Array.isArray(inputValidation.errors) && inputValidation.errors.length) {
        DAO_UI.setStatus(
          "generateStatus",
          `Input check stopped compilation before the AI model was called: ${inputValidation.errors[0].message}`,
          "error"
        );
        DAO_UI.showJson("proposalOutput", {
          stage: "PRE_COMPILATION_INPUT_CHECK",
          valid: false,
          errors: inputValidation.errors,
          hint: "Correct the explicit conflicting/malformed information, or omit system-known values so YanFu can use configuration."
        });
      } else {
        DAO_UI.setStatus("generateStatus", error.message, "error");
        if (error.data?.plan) DAO_UI.showJson("proposalOutput", error.data.plan);
      }
    }
  };
});
