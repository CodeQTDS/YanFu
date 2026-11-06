function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function deterministicActionRisk(action) {
  const profile = action.riskProfile || {};
  let score = numeric(profile.flatWeight, 0);

  if (profile.itemArgument) {
    const items = action.arguments?.[profile.itemArgument];
    if (Array.isArray(items)) {
      score += items.length * numeric(profile.weightPerItem, 0);
    }
  }

  if (profile.maxWeight !== undefined) {
    score = Math.min(score, numeric(profile.maxWeight, score));
  }

  return score;
}

function actionAnalysisPenalty(actionAnalysis) {
  const severities = (actionAnalysis?.findings || []).map(item => String(item.severity || "").toUpperCase());
  if (severities.includes("CRITICAL")) return 50;
  if (severities.includes("HIGH")) return 40;
  if (severities.includes("MEDIUM")) return 15;
  return 0;
}

function consolidateRisk({ aiRisk = "LOW", proposal, simulation, actionAnalysis = null }) {
  const normalized = String(aiRisk || "LOW").toUpperCase();
  const aiRiskScore = normalized === "HIGH" ? 70 : normalized === "MEDIUM" ? 35 : 0;
  const actionRiskScore = (proposal.actions || [])
    .reduce((total, action) => total + deterministicActionRisk(action), 0);
  const simulationPenalty = simulation?.allSuccessful === false ? 40 : 0;
  const deterministicAnalysisPenalty = actionAnalysisPenalty(actionAnalysis);

  const score = Math.min(
    100,
    aiRiskScore + actionRiskScore + simulationPenalty + deterministicAnalysisPenalty
  );
  const level = score >= 70 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

  return {
    score,
    level,
    aiRisk: normalized,
    breakdown: {
      aiRiskScore,
      actionRiskScore,
      simulationPenalty,
      deterministicAnalysisPenalty
    }
  };
}

module.exports = {
  consolidateRisk,
  deterministicActionRisk,
  actionAnalysisPenalty
};
