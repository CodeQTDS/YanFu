const crypto = require("crypto");
const { generateJson } = require("../ai/modelClient");
const { loadPromptTemplates } = require("../config/configLoader");
const { getChainContext } = require("../chain/context");
const {
  buildCapabilityRegistry,
  plannerCapabilities
} = require("./capabilityRegistry");
const { extractFacts } = require("./factExtractor");
const { validateSourceIntent, sourceIntentConsistencyReview } = require("./sourceIntentGuard");
const { validatePlan } = require("./validator");
const { buildGovernorProposal } = require("./encoder");
const { proposalFingerprint } = require("./integrity");
const { resolveConfiguredTokenSymbol } = require("./tokenSymbolResolver");


function compilationStageContract(chainContext) {
  const symbol = typeof chainContext?.token?.symbol === "string"
    ? chainContext.token.symbol
    : "configured governance token";
  const decimals = Number.isInteger(Number(chainContext?.token?.decimals))
    ? Number(chainContext.token.decimals)
    : 18;

  return {
    stagePurpose: "Translate complete user intent into semantic operations. Do not approve/reject based on balance, simulation likelihood, or policy risk.",
    readyWhen: [
      "Every required capability argument is explicit in the request or safely resolved by a documented configured default.",
      "Every requested action maps to an available capability, including multiple operations in one governance proposal."
    ],
    clarificationOnlyWhen: [
      "A required semantic argument is missing.",
      "The request is internally contradictory.",
      "The requested action cannot be mapped to an available capability without inventing information."
    ],
    neverClarifySolelyBecause: [
      "The Treasury may have insufficient balance; compile it and let Analyze/Review report execution risk.",
      "The requested parameter is risky or unusual but allowed by capability validation metadata.",
      "One governance proposal requires multiple operations/actions."
    ],
    unitContract: {
      configuredTokenSymbol: symbol,
      configuredTokenDecimals: decimals,
      tokenSymbolValues: `Values written as <number> ${symbol} are human-readable token amounts; keep the number in human units.`,
      ethValues: "Values written as <number> ETH are human-readable ether amounts; keep the number in ETH.",
      rawUnits: "Treat a value as raw/base units only when the user explicitly says raw units, base units or wei."
    },
    proposalStructure: "One governance proposal can contain multiple operations. 'One proposal' does not mean 'one action' or 'one contract call'."
  };
}

function generationPrompt({ text, capabilities, chainContext, facts, iterationContext = null }) {
  const templates = loadPromptTemplates();
  const template = templates.generation;

  return [
    template.system,
    "",
    "COMPILATION-STAGE CONTRACT:",
    JSON.stringify(compilationStageContract(chainContext), null, 2),
    "",
    "RULES:",
    ...template.rules.map(rule => `- ${rule}`),
    "",
    "OUTPUT JSON SCHEMA:",
    JSON.stringify({
      status: "ready | needs-clarification",
      intentSummary: "short summary",
      description: "proposal description",
      operations: [
        {
          capabilityId: "one supplied capability id",
          arguments: { "inputName": "human-readable value" }
        }
      ],
      unresolved: [{ field: "field", reason: "reason" }],
      assumptions: []
    }, null, 2),
    "",
    "ITERATION / REVIEW LOOP PROVENANCE (OPTIONAL):",
    JSON.stringify(iterationContext || null, null, 2),
    "",
    "CURRENT CHAIN CONTEXT:",
    JSON.stringify(chainContext, null, 2),
    "",
    "AVAILABLE CAPABILITIES:",
    JSON.stringify(capabilities, null, 2),
    "",
    "DETERMINISTIC FACTS EXTRACTED FROM THE USER REQUEST:",
    JSON.stringify(facts, null, 2),
    "",
    "USER REQUEST:",
    text
  ].join("\n");
}

async function generateProposal({ text, model, iterationContext = null }) {
  const sourceText = String(text || "").trim();
  if (!sourceText) throw new Error("Proposal request text is required");

  const registry = buildCapabilityRegistry();

  // Stage 0: deterministic source-input consistency check. This runs before
  // chain reads and before any LLM call. System-known values may be omitted,
  // but explicit conflicting/malformed values must never be silently repaired.
  const inputValidation = validateSourceIntent({ sourceText, registry });
  if (!inputValidation.valid) {
    const detail = inputValidation.errors.map(item => item.message).join("; ");
    const error = new Error(`Input consistency check failed: ${detail}`);
    error.code = "INPUT_CONFLICT";
    error.inputValidation = inputValidation;
    throw error;
  }

  const chainContext = await getChainContext();
  const capabilities = plannerCapabilities(registry);
  const facts = extractFacts(sourceText);

  const ai = await generateJson({
    modelId: model,
    prompt: generationPrompt({ text: sourceText, capabilities, chainContext, facts, iterationContext }),
    temperature: 0.05
  });

  const plan = ai.json;
  if (plan.status === "needs-clarification" || (plan.unresolved || []).length) {
    const detail = (plan.unresolved || [])
      .map(item => `${item.field}: ${item.reason}`)
      .join("; ");
    const error = new Error(`Proposal requires clarification${detail ? `: ${detail}` : ""}`);
    error.code = "NEEDS_CLARIFICATION";
    error.plan = plan;
    throw error;
  }

  // A model may emit the chain-verified ERC20 ticker (for example "MTK")
  // in the ABI address field. Resolve only that exact configured symbol for
  // registered Treasury ERC20 capabilities, and only when the request names
  // the same symbol. Do not coerce arbitrary text, unknown tokens, or an
  // explicitly supplied different token address.
  resolveConfiguredTokenSymbol({ plan, chainContext, registry, sourceText });

  const validation = validatePlan({ plan, registry, sourceText });
  if (!validation.valid) {
    // Preserve the model's actual JSON for controlled local diagnostics. A
    // malformed plan is never encoded or submitted; it remains a hard failure.
    const error = new Error(`Proposal plan validation failed: ${validation.errors.join("; ")}`);
    error.code = "INVALID_GENERATED_PLAN";
    error.plan = plan;
    throw error;
  }

  const intentCheck = sourceIntentConsistencyReview({ proposal: {sourceText,plan}, registry });
  if (!intentCheck.passed) {
    const error = new Error(`Generated plan contradicts explicit source constraints: ${intentCheck.findings.map(f=>f.message).join("; ")}`);
    error.code = "SOURCE_INTENT_MISMATCH";
    throw error;
  }

  const proposal = buildGovernorProposal({
    plan,
    registry,
    description: plan.description || sourceText,
    metadata: {
      generatedBy: ai.modelId,
      generatedAt: new Date().toISOString(),
      sourceText,
      chainId: chainContext.chainId,
      blockNumber: chainContext.blockNumber,
      iterationContext: iterationContext || null
    }
  });

  proposal.draftId = crypto.randomUUID();
  proposal.sourceText = sourceText;
  proposal.plan = plan;
  proposal.generatorModel = ai.modelId;
  proposal.chainContext = chainContext;
  proposal.fingerprint = proposalFingerprint(proposal);
  proposal.editable = true;
  proposal.inputValidation = inputValidation;

  return proposal;
}

module.exports = {
  generateProposal,
  generationPrompt,
  compilationStageContract
};
