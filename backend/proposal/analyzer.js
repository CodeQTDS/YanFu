const { generateJson } = require("../ai/modelClient");
const { loadPromptTemplates } = require("../config/configLoader");
const { getChainContext } = require("../chain/context");
const { simulateProposalCalls } = require("../chain/simulator");
const { validateGovernorProposalShape } = require("./validator");
const { consolidateRisk } = require("./riskEngine");
const { analyzeProposalActions } = require("./actionAnalyzer");

function isTransientAnalysisTransportError(error) {
  const message = String(error?.message || error || "");
  return /(network|socket hang up|socket disconnected|premature close|other side closed|TLS|ECONNRESET|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_NETWORK|ERR_BAD_RESPONSE|timed out|timeout|HTTP 408|HTTP 425|HTTP 429|HTTP 5\d\d)/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateAnalysisJsonWithRetry(options) {
  try {
    const result = await generateJson(options);
    return { ...result, transportRetryCount: 0 };
  } catch (firstError) {
    if (!isTransientAnalysisTransportError(firstError)) throw firstError;
    const delayMs = Math.max(0, Number(process.env.AI_ANALYSIS_RETRY_DELAY_MS || 2000));
    if (delayMs) await wait(delayMs);
    try {
      const result = await generateJson(options);
      return { ...result, transportRetryCount: 1 };
    } catch (secondError) {
      const error = new Error(`Analysis AI transport failed after one retry: ${secondError.message}`);
      error.cause = secondError;
      error.firstError = firstError.message;
      error.transportRetryCount = 1;
      throw error;
    }
  }
}

function analysisPrompt({ proposal, chainContext, simulation, actionAnalysis }) {
  const template = loadPromptTemplates().analysis;
  return [
    template.system,
    "",
    "RULES:",
    ...template.rules.map(rule => `- ${rule}`),
    "",
    "OUTPUT JSON SCHEMA:",
    JSON.stringify({
      aiRisk: "LOW | MEDIUM | HIGH",
      summary: "analysis summary",
      advice: "actionable advice",
      observations: ["observation"]
    }, null, 2),
    "",
    "PROPOSAL:",
    JSON.stringify(proposal, null, 2),
    "",
    "DETERMINISTIC ACTION / CAPABILITY ANALYSIS:",
    JSON.stringify(actionAnalysis, null, 2),
    "",
    "FRESH CHAIN CONTEXT:",
    JSON.stringify(chainContext, null, 2),
    "",
    "DETERMINISTIC CALL SIMULATION:",
    JSON.stringify(simulation, null, 2)
  ].join("\n");
}

async function analyzeProposal({ proposal, model }) {
  const shape = validateGovernorProposalShape(proposal);
  if (!shape.valid) {
    throw new Error(`Proposal shape validation failed: ${shape.errors.join("; ")}`);
  }

  const [chainContext, simulation] = await Promise.all([
    getChainContext(),
    simulateProposalCalls(proposal)
  ]);
  const actionAnalysis = analyzeProposalActions({ proposal, chainContext });

  const ai = await generateAnalysisJsonWithRetry({
    modelId: model,
    prompt: analysisPrompt({ proposal, chainContext, simulation, actionAnalysis }),
    temperature: 0.1
  });

  const aiRisk = String(ai.json.aiRisk || "MEDIUM").toUpperCase();
  const riskScore = consolidateRisk({ aiRisk, proposal, simulation, actionAnalysis });

  return {
    analyzedAt: new Date().toISOString(),
    model: ai.modelId,
    simulation,
    chainContext,
    actionAnalysis,
    aiRisk,
    risk: riskScore.level,
    riskScore,
    summary: ai.json.summary || "",
    advice: ai.json.advice || "",
    observations: Array.isArray(ai.json.observations) ? ai.json.observations : [],
    transportRetryCount: Number(ai.transportRetryCount || 0)
  };
}

module.exports = {
  analyzeProposal,
  analysisPrompt,
  isTransientAnalysisTransportError,
  generateAnalysisJsonWithRetry
};
