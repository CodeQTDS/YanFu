const { generate } = require("../ai/modelClient");
const { extractJson } = require("../utils/json");
const {
  loadPromptTemplates,
  loadReviewPolicy,
  loadReviewersConfig
} = require("../config/configLoader");

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean);
}

function findProfile(profileId) {
  const config = loadReviewersConfig();
  const fallback = config.profiles?.[0] || null;
  if (!profileId) return fallback;
  return config.profiles?.find(item => item.id === profileId) || fallback;
}

function selector(calldata) {
  const text = String(calldata || "");
  return text.startsWith("0x") && text.length >= 10 ? text.slice(0, 10) : text;
}

function compactAction(action, index) {
  return {
    index,
    capabilityId: action?.capabilityId || null,
    sourceCapabilityId: action?.sourceCapabilityId || null,
    pack: action?.pack || null,
    contractType: action?.contractType || null,
    target: action?.target || null,
    functionName: action?.functionName || null,
    functionSignature: action?.functionSignature || null,
    humanArguments: action?.arguments || {},
    encodedArguments: action?.encodedArguments || [],
    value: action?.value || "0",
    calldataSelector: selector(action?.calldata)
  };
}

function compactSimulation(simulation) {
  return {
    caller: simulation?.caller || null,
    allSuccessful: simulation?.allSuccessful !== false,
    caveat: simulation?.caveat || null,
    results: (simulation?.results || []).map(item => ({
      index: item.index,
      target: item.target,
      success: item.success !== false,
      blocker: Boolean(item.blocker),
      error: item.error || null
    }))
  };
}

function compactAnalysis(analysis) {
  if (!analysis) return null;
  return {
    model: analysis.model || null,
    aiRisk: analysis.aiRisk || null,
    risk: analysis.risk || analysis?.riskScore?.level || null,
    riskScore: analysis?.riskScore?.score ?? null,
    riskBreakdown: analysis?.riskScore?.breakdown || null,
    summary: analysis.summary || "",
    advice: analysis.advice || "",
    observations: analysis.observations || [],
    actionAnalysis: analysis.actionAnalysis || null
  };
}

function compactChainContext(chainContext) {
  return {
    chainId: chainContext?.chainId ?? null,
    expectedChainId: chainContext?.expectedChainId ?? null,
    blockNumber: chainContext?.blockNumber ?? null,
    addresses: chainContext?.addresses || {},
    governance: chainContext?.governance || {},
    token: chainContext?.token || {},
    treasury: chainContext?.treasury || {},
    daoSettings: chainContext?.daoSettings || {},
    contracts: chainContext?.contracts || {}
  };
}

function buildReviewEvidencePacket({ proposal, analysis, evidence }) {
  return {
    sourceRequest: proposal?.sourceText || proposal?.metadata?.sourceText || proposal?.description || "",
    proposal: {
      fingerprint: evidence?.proposalFingerprint || proposal?.fingerprint || null,
      description: proposal?.description || "",
      provenance: {
        sourceRequestIsOriginal: true,
        editedByHuman: proposal?.metadata?.editedBy === "HUMAN",
        humanGovernorOverride: proposal?.metadata?.humanGovernorOverride === true,
        semanticPlanStatus: proposal?.metadata?.semanticPlanStatus || "CURRENT",
        priorFingerprint: proposal?.metadata?.previousFingerprint || null,
        note: "A human rewrite changes the payload, not the recorded source request. Do not assume a new human intent supersedes the original without an explicit new request."
      },
      encodedGovernor: {
        isAuthoritativeExecution: true,
        actions: evidence?.executableActions || [],
        undecodedActionCount: (evidence?.executableActions || []).filter(item => !item.decoded).length
      },
      semanticActionsAreHistorical: Boolean(evidence?.historicalPlan),
      plan: !evidence?.historicalPlan && proposal?.plan ? {
        status: proposal.plan.status || null,
        intentSummary: proposal.plan.intentSummary || null,
        description: proposal.plan.description || null,
        operations: proposal.plan.operations || [],
        unresolved: proposal.plan.unresolved || [],
        assumptions: proposal.plan.assumptions || []
      } : null,
      actions: evidence?.historicalPlan ? [] : (proposal?.actions || []).map(compactAction)
    },
    sourceIntentConsistency: evidence?.sourceIntent || evidence?.deterministic?.sourceIntent || null,
    deterministicReview: {
      passed: evidence?.deterministic?.passed !== false,
      findings: evidence?.deterministic?.findings || []
    },
    simulation: compactSimulation(evidence?.simulation),
    deterministicActionAnalysis: evidence?.actionAnalysis || null,
    priorAnalysis: compactAnalysis(analysis),
    chainContext: compactChainContext(evidence?.chainContext)
  };
}

function reviewerOutputSchema() {
  return {
    workSummary: "role-specific summary that explains the unique checks for this profile",
    roleAssessment: {
      focus: "the selected reviewer's primary mission",
      evidenceChecked: ["specific evidence or values this role checked"],
      conclusion: "conclusion from this role's perspective, not a repeat of the common blocker text",
      uncertainty: null,
      decisionBasis: "TECHNICAL_COMPLIANCE | INTENT_FIDELITY | GOVERNANCE_POLICY | MIXED",
      residualGovernanceRisk: "NONE | LOW | MEDIUM | HIGH | CRITICAL | NOT_ASSESSED",
      governanceRiskReason: "grounded reason, or null when not assessed"
    },
    verdict: "APPROVE | NEEDS_CHANGES | REJECT",
    confidence: 0.0,
    findings: [
      {
        severity: "INFO | LOW | MEDIUM | HIGH | CRITICAL",
        category: "short-category",
        actionIndex: 0,
        message: "evidence-backed finding",
        suggestion: "required human action or null"
      }
    ],
    recommendedAdjustments: ["specific required change"],
    revisedNaturalLanguage: null
  };
}

function buildReviewPrompt({ proposal, analysis, evidence, model, profile, reviewerIndex, roundContext }) {
  const policy = loadReviewPolicy();
  const template = loadPromptTemplates().review;
  const packet = buildReviewEvidencePacket({ proposal, analysis, evidence });

  return [
    template.system,
    "",
    `REVIEWER SLOT: ${reviewerIndex + 1}`,
    `MODEL ID: ${model}`,
    `PROFILE: ${profile?.label || profile?.id || "General Governance"}`,
    "",
    "DECISION CONTRACT:",
    "1. HIGH/CRITICAL deterministic blockers => do not APPROVE.",
    "2. Passing deterministic checks and simulation is NOT sufficient to mandate APPROVE. Separately judge evidence-grounded consequences from YOUR assigned role.",
    "3. NEEDS_CHANGES requires a specific justified remedy or missing decision. REJECT means present design/intent is unacceptable on substantiated grounds. APPROVE is correct when no concrete blocking objection remains.",
    "4. Distinguish a governance-policy recommendation from a violated capability rule. Do not invent technical blockers or missing evidence; a human acknowledgement of risk does not compel approval.",
    "5. Evaluate only evidence in REVIEW EVIDENCE PACKET; never demand unrelated information solely to manufacture disagreement.",
    "",
    "PROMPT RULES:",
    ...template.rules.map(rule => `- ${rule}`),
    "",
    "ROLE MISSION (PRIORITY FOR YOUR INDIVIDUAL REPORT):",
    `Primary mission: ${profile?.primaryMission || profile?.description || "Balanced governance review"}`,
    "Role-specific questions (answer using actual evidence; state not-applicable when needed):",
    ...(profile?.roleQuestions || profile?.instructions || []).map((rule, index) => `${index + 1}. ${rule}`),
    "Prioritized evidence sections:",
    ...((profile?.evidencePriorities || []).map(item => `- ${item}`)),
    "ROLE-SPECIFIC VERDICT CRITERIA (APPLY IN ADDITION TO MANDATORY SAFETY CHECKS):",
    ...((profile?.decisionCriteria || []).map((item, index) => `${index + 1}. ${item}`)),
    "SHARED SAFETY BOUNDARY:",
    "Every role must respect deterministic HIGH/CRITICAL blockers and original source provenance; verdicts can legitimately agree.",
    "Do NOT reuse the source-intent mismatch as your entire workSummary, roleAssessment or findings when your assigned role is broader or different.",
    "Distinguish a previously requested amount from the currently encoded amount, and distinguish a human payload edit from a new authorized source request.",
    "Treat proposal.encodedGovernor.actions as the authoritative executed calls. When semanticActionsAreHistorical=true, do NOT use proposal.plan or proposal.actions as proof of current executable parameters.",
    "When an action could not be decoded, explicitly report that evidence limit; do not infer its recipient/amount from a stale semantic plan.",
    "",
    "REVIEW POLICY REQUIRED CHECKS:",
    JSON.stringify(policy.requiredChecks || [], null, 2),
    "",
    "ROUND CONTEXT:",
    JSON.stringify(roundContext || null, null, 2),
    "",
    "ROLE ASSESSMENT RULES:",
    "Populate roleAssessment.focus, evidenceChecked and conclusion for YOUR role. Use actual values when present, and explain not-applicable/unknown instead of inventing facts.",
    "Keep workSummary and AI findings focused on your assigned mission. The common deterministic blocker list is shared once by the system; it does not need to be copied verbatim.",
    "Different roles may reach identical verdicts; do not manufacture disagreement just to sound distinct.",
    "Identify decisionBasis and residualGovernanceRisk. Explain any HIGH/CRITICAL residual risk, including why it is acceptable or unacceptable within your role's mandate.",
    "Do not say 'no deterministic blocker' as the sole reason to APPROVE if your role has identified a severe governance-policy concern. Analyze whether that concern warrants a negative recommendation.",
    "OUTPUT CONTRACT:",
    "Return exactly one valid JSON object. No markdown fences. No reasoning text outside JSON. Use [] for empty arrays and null for no revisedNaturalLanguage.",
    JSON.stringify(reviewerOutputSchema(), null, 2),
    "",
    "REVIEW EVIDENCE PACKET:",
    JSON.stringify(packet, null, 2)
  ].join("\n");
}

function buildFormatRetryPrompt({ originalPrompt }) {
  return [
    originalPrompt,
    "",
    "STRICT FORMAT RETRY:",
    "Your previous response could not be parsed as JSON. Return ONLY one compact JSON object matching OUTPUT CONTRACT.",
    "Do not include markdown, code fences, comments, analysis/reasoning, or text before/after the JSON object.",
    "Use double-quoted JSON keys/strings, no trailing commas, confidence as a number 0..1, arrays as valid JSON arrays, and revisedNaturalLanguage as a string or null."
  ].join("\n");
}

function isTransientReviewerTransportError(error) {
  const message = String(error?.message || error || "");
  return /(fetch failed|network|socket hang up|socket disconnected|premature close|other side closed|TLS|ECONNRESET|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_NETWORK|ERR_BAD_RESPONSE|timed out|timeout|HTTP 408|HTTP 425|HTTP 429|HTTP 5\d\d)/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateWithTransientRetry(options) {
  const maxRetries = Math.max(0, Math.min(3, Number(process.env.AI_REVIEW_TRANSPORT_RETRIES || 2)));
  const baseDelayMs = Math.max(0, Number(process.env.AI_REVIEW_RETRY_DELAY_MS || 2000));
  const errors = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await generate(options);
      return { ...result, transportRetryCount: attempt };
    } catch (error) {
      errors.push(error);
      const canRetry = attempt < maxRetries && isTransientReviewerTransportError(error);
      if (!canRetry) {
        if (attempt === 0) throw error;
        const wrapped = new Error(`Reviewer AI transport failed after ${attempt} retr${attempt === 1 ? "y" : "ies"}: ${error.message}`);
        wrapped.cause = error;
        wrapped.firstError = errors[0]?.message || null;
        wrapped.transportRetryCount = attempt;
        throw wrapped;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      if (delayMs) await wait(delayMs);
    }
  }

  throw new Error("Reviewer AI transport retry loop ended unexpectedly");
}

async function generateReviewerJson({ modelId, prompt }) {
  const first = await generateWithTransientRetry({
    modelId,
    prompt,
    responseType: "json",
    temperature: 0.05,
    maxOutputTokens: 4096
  });
  const firstJson = extractJson(first.text);
  if (firstJson) {
    return {
      ...first,
      json: firstJson,
      formatRetry: false,
      transportRetryCount: first.transportRetryCount || 0
    };
  }

  const second = await generateWithTransientRetry({
    modelId,
    prompt: buildFormatRetryPrompt({ originalPrompt: prompt }),
    responseType: "json",
    temperature: 0,
    maxOutputTokens: 4096
  });
  const secondJson = extractJson(second.text);
  if (!secondJson) {
    throw new Error(`AI model ${second.modelId} did not return valid JSON after one strict-format retry`);
  }
  return {
    ...second,
    json: secondJson,
    formatRetry: true,
    transportRetryCount: (first.transportRetryCount || 0) + (second.transportRetryCount || 0)
  };
}

function fallbackRevision({ proposal, adjustments, findings }) {
  const source = String(proposal.sourceText || proposal.metadata?.sourceText || proposal.description || "").trim();
  const requirements = adjustments.length
    ? adjustments
    : (findings || [])
        .filter(item => ["HIGH", "CRITICAL"].includes(String(item?.severity || "").toUpperCase()))
        .map(item => item.suggestion || item.message)
        .filter(Boolean);
  if (!source || requirements.length === 0) return null;
  return [source, "", "Required corrections before recompilation:", ...requirements.map(item => `- ${item}`)].join("\n");
}

async function runSingleReviewer({ proposal, analysis = null, model, profileId, reviewerIndex = 0, evidence, roundContext = null }) {
  const policy = loadReviewPolicy();
  const profile = findProfile(profileId);
  const prompt = buildReviewPrompt({ proposal, analysis, evidence, model, profile, reviewerIndex, roundContext });
  const ai = await generateReviewerJson({ modelId: model, prompt });

  const allowedVerdicts = new Set(policy.verdicts || []);
  let verdict = String(ai.json.verdict || "NEEDS_CHANGES").toUpperCase();
  if (!allowedVerdicts.has(verdict)) verdict = "NEEDS_CHANGES";
  if (!evidence.deterministic.passed && verdict === "APPROVE") verdict = "NEEDS_CHANGES";

  const aiFindings = Array.isArray(ai.json.findings)
    ? ai.json.findings.map(item => ({ source: "ai-reviewer", ...item }))
    : [];
  let recommendedAdjustments = normalizeStringArray(ai.json.recommendedAdjustments);
  const blockingDeterministic = (evidence.deterministic.findings || [])
    .filter(item => ["HIGH", "CRITICAL"].includes(String(item.severity || "").toUpperCase()));

  if (verdict !== "APPROVE" && recommendedAdjustments.length === 0) {
    recommendedAdjustments = [...blockingDeterministic, ...aiFindings]
      .map(item => item.suggestion || item.message)
      .filter(Boolean);
  }

  const rawConfidence = Number(ai.json.confidence ?? 0);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const workSummary = String(ai.json.workSummary || ai.json.summary || "").trim() ||
    `Reviewed the proposal with ${profile?.label || "General Governance"} focus.`;
  const providedAssessment = ai.json.roleAssessment;
  const assessment = providedAssessment && typeof providedAssessment === "object" && !Array.isArray(providedAssessment)
    ? {
        focus: String(providedAssessment.focus || profile?.primaryMission || profile?.label || "General Governance"),
        evidenceChecked: normalizeStringArray(providedAssessment.evidenceChecked),
        conclusion: String(providedAssessment.conclusion || "").trim(),
        uncertainty: providedAssessment.uncertainty == null ? null : String(providedAssessment.uncertainty),
        decisionBasis: ["TECHNICAL_COMPLIANCE", "INTENT_FIDELITY", "GOVERNANCE_POLICY", "MIXED"].includes(String(providedAssessment.decisionBasis || "").toUpperCase())
          ? String(providedAssessment.decisionBasis).toUpperCase() : "NOT_ASSESSED",
        residualGovernanceRisk: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL", "NOT_ASSESSED"].includes(String(providedAssessment.residualGovernanceRisk || "").toUpperCase())
          ? String(providedAssessment.residualGovernanceRisk).toUpperCase() : "NOT_ASSESSED",
        governanceRiskReason: providedAssessment.governanceRiskReason == null ? null : String(providedAssessment.governanceRiskReason).trim()
      }
    : null;

  let revisedNaturalLanguage = typeof ai.json.revisedNaturalLanguage === "string" && ai.json.revisedNaturalLanguage.trim()
    ? ai.json.revisedNaturalLanguage.trim()
    : null;
  let revisionSource = revisedNaturalLanguage ? "ai-reviewer" : null;
  if (verdict !== "APPROVE" && !revisedNaturalLanguage) {
    revisedNaturalLanguage = fallbackRevision({ proposal, adjustments: recommendedAdjustments, findings: [...blockingDeterministic, ...aiFindings] });
    revisionSource = revisedNaturalLanguage ? "deterministic-fallback" : null;
  }

  return {
    status: "COMPLETED",
    reviewerId: `reviewer-${reviewerIndex + 1}`,
    reviewerIndex,
    reviewedAt: new Date().toISOString(),
    model: ai.modelId,
    profile: profile ? {
      id: profile.id, label: profile.label, description: profile.description || "",
      primaryMission: profile.primaryMission || profile.description || "",
      assignedChecks: profile.roleQuestions || []
    } : null,
    verdict,
    confidence,
    workSummary,
    roleAssessment: assessment,
    findings: aiFindings,
    deterministicBlockers: blockingDeterministic,
    recommendedAdjustments,
    revisedNaturalLanguage,
    revisionSource,
    evidenceFingerprint: evidence.proposalFingerprint,
    policyVersion: policy.version,
    formatRetry: Boolean(ai.formatRetry),
    transportRetryCount: Number(ai.transportRetryCount || 0)
  };
}

module.exports = {
  runSingleReviewer,
  buildReviewPrompt,
  buildReviewEvidencePacket,
  generateReviewerJson,
  findProfile,
  fallbackRevision
};
