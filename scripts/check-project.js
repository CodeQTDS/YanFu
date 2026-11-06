const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "START_HERE.md",
  "README.md",
  "ARCHITECTURE.md",
  "docs/DEVELOPER_GUIDE.md",
  "docs/REVIEW_PROTOCOL.md",
  "config/app.config.json",
  "config/chain.config.json",
  "config/models.config.json",
  "config/proposal-elements.json",
  "config/contract-type-templates.json",
  "config/registered-contracts.json",
  "config/input-validation.json",
  "config/review-policy.json",
  "config/reviewers.config.json",
  "config/prompt-templates.json",
  "backend/server.js",
  "backend/utils/logger.js",
  "backend/proposal/generator.js",
  "backend/proposal/sourceIntentGuard.js",
  "backend/proposal/semanticResolvers.js",
  "backend/proposal/actionAnalyzer.js",
  "backend/proposal/analyzer.js",
  "backend/proposal/reviewer.js",
  "backend/proposal/editor.js",
  "backend/review/evidence.js",
  "backend/review/reviewerEngine.js",
  "backend/review/consensus.js",
  "backend/review/orchestrator.js",
  "backend/review/requestAdapter.js",
  "frontend/assets/js/api.js",
  "frontend/assets/js/models.js",
  "frontend/assets/js/nav.js",
  "frontend/assets/js/review.js",
  "frontend/assets/js/editor.js",
  "frontend/index.html",
  "frontend/pages/generate.html",
  "frontend/pages/analyze.html",
  "frontend/pages/review.html",
  "frontend/pages/editor.html",
  "test/capability-cases.json",
  "test/treasury-batch-eth.test.js",
  "scripts/test-capabilities.js",
  "scripts/run-yanfu-ai-pipeline-test.js",
  "test/auto/yanfu-ai-pipeline-cases.json",
  "docs/TESTING.md",
  "docs/CAPABILITIES.md",
  "docs/TESTING.md"
];

let failed = false;

for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    failed = true;
    console.error("MISSING", relative);
    if (relative.startsWith("backend/review/")) {
      console.error("  FIX: restore the complete backend/review directory from the v1.0 repair pack.");
    }
  } else {
    console.log("OK", relative);
  }
}

for (const relative of fs.readdirSync(path.join(root, "config"))) {
  if (!relative.endsWith(".json")) continue;
  const full = path.join(root, "config", relative);
  try {
    JSON.parse(fs.readFileSync(full, "utf8"));
    console.log("VALID JSON", `config/${relative}`);
  } catch (error) {
    failed = true;
    console.error("INVALID JSON", relative, error.message);
  }
}

try {
  const reviewers = JSON.parse(
    fs.readFileSync(path.join(root, "config/reviewers.config.json"), "utf8")
  );
  const max = Number(reviewers.limits?.maxReviewers);
  if (max !== 5) {
    failed = true;
    console.error("INVALID REVIEWER LIMIT", `Expected config/reviewers.config.json limits.maxReviewers=5, received ${Number.isNaN(max) ? "missing limits.maxReviewers" : max}`);
  }
  if (!Array.isArray(reviewers.profiles) ||
      !reviewers.profiles.some(profile => profile.id === "general-governance")) {
    failed = true;
    console.error("INVALID REVIEWER PROFILES", "Add the general-governance profile from the v1.0 reviewer configuration");
  }
  if (!reviewers.profiles?.some(profile => profile.id === "intent-fidelity")) {
    failed = true;
    console.error("INVALID REVIEWER PROFILES", "The intent-fidelity reviewer role is required in v1.0");
  }
  if (!Array.isArray(reviewers.profileDefaults) || reviewers.profileDefaults.length < 1) {
    failed = true;
    console.error("INVALID REVIEWER PROFILES", "profileDefaults must provide default reviewer-role assignments");
  }
  if (reviewers.limits?.requireUniqueModels !== false || reviewers.limits?.requireUniqueModelRolePairs !== true) {
    failed = true;
    console.error("INVALID REVIEWER POLICY", "config/reviewers.config.json limits.requireUniqueModels must be false and requireUniqueModelRolePairs must be true");
  }
} catch (error) {
  failed = true;
  console.error("REVIEWER CONFIG CHECK FAILED", error.message);
}

try {
  const app = JSON.parse(
    fs.readFileSync(path.join(root, "config/app.config.json"), "utf8")
  );
  const levels = new Set(["off", "error", "info", "verbose", "debug"]);
  const level = String(app.logging?.level || "").toLowerCase();

  if (app.version !== fs.readFileSync(path.join(root, "VERSION"), "utf8").trim()) {
    failed = true;
    console.error("INVALID APP VERSION", `Expected VERSION file to match app.version, received ${app.version}`);
  }

  if (app.workflow?.enforceSequentialStages !== true) {
    failed = true;
    console.error("INVALID WORKFLOW POLICY", "workflow.enforceSequentialStages must be true");
  }
  if (app.workflow?.requireAnalysisBeforeReview !== true) {
    failed = true;
    console.error("INVALID WORKFLOW POLICY", "workflow.requireAnalysisBeforeReview must be true");
  }
  if (app.workflow?.requireReviewBeforeSubmit !== true) {
    failed = true;
    console.error("INVALID WORKFLOW POLICY", "workflow.requireReviewBeforeSubmit must be true");
  }

  if (!levels.has(level)) {
    failed = true;
    console.error("INVALID LOG LEVEL", `Unsupported logging.level=${level || "<empty>"}`);
  }

  if (!Number.isFinite(Number(app.logging?.slowRequestMs)) || Number(app.logging?.slowRequestMs) < 0) {
    failed = true;
    console.error("INVALID LOG CONFIG", "logging.slowRequestMs must be a non-negative number");
  }

  const humanEditOverride = app.workflow?.humanEditOverride;
  if (!humanEditOverride || humanEditOverride.enabled !== true) {
    failed = true;
    console.error("INVALID HUMAN EDIT OVERRIDE", "workflow.humanEditOverride.enabled must be true for YanFu v1.0");
  }
  if (humanEditOverride.requirePreviousReviewSession !== true) {
    failed = true;
    console.error("INVALID HUMAN EDIT OVERRIDE", "requirePreviousReviewSession must be true");
  }
  if (humanEditOverride.requireFreshValidation !== true) {
    failed = true;
    console.error("INVALID HUMAN EDIT OVERRIDE", "requireFreshValidation must be true");
  }
} catch (error) {
  failed = true;
  console.error("APP CONFIG CHECK FAILED", error.message);
}


// Detect all missing local require() imports, not just the hardcoded file list.
// This catches incompatible source layouts before `node backend/server.js` fails.
function findJavascriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const next = path.join(directory, item.name);
    return item.isDirectory() ? findJavascriptFiles(next)
      : item.isFile() && item.name.endsWith(".js") ? [next] : [];
  });
}

let unresolvedImports = 0;
for (const file of [...findJavascriptFiles(path.join(root, "backend")), ...findJavascriptFiles(path.join(root, "scripts"))]) {
  const code = fs.readFileSync(file, "utf8");
  const staticImports = /\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const match of code.matchAll(staticImports)) {
    const local = path.resolve(path.dirname(file), match[1]);
    const exists = [local, `${local}.js`, `${local}.json`, path.join(local, "index.js")]
      .some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!exists) {
      unresolvedImports++;
      failed = true;
      console.error("UNRESOLVED LOCAL IMPORT", `${path.relative(root, file)} -> ${match[1]}`);
    }
  }
}
if (!unresolvedImports) console.log("OK local JavaScript import paths");


// Review request compatibility regression: both legacy `models` and canonical
// `reviewers` payloads must normalize to the same reviewer-engine shape.
try {
  const { normalizeReviewerRequest } = require(path.join(root, "backend/review/requestAdapter"));
  const legacy = normalizeReviewerRequest({
    models: ["model-a", "model-b", "model-c"]
  });
  const canonical = normalizeReviewerRequest({
    reviewers: [
      { model: "model-a", profileId: "general-governance" },
      { model: "model-b", profileId: "general-governance" },
      { model: "model-c", profileId: "general-governance" }
    ]
  });

  if (legacy.reviewers.length !== 3 || canonical.reviewers.length !== 3) {
    failed = true;
    console.error("REVIEW REQUEST ADAPTER FAILED", "Expected both payload shapes to produce 3 reviewers");
  } else if (legacy.reviewers.some(item => !item.model || !item.profileId)) {
    failed = true;
    console.error("REVIEW REQUEST ADAPTER FAILED", "Legacy models payload did not receive canonical reviewer profiles");
  } else {
    console.log("OK review request compatibility (models[] + reviewers[])");
  }
} catch (error) {
  failed = true;
  console.error("REVIEW REQUEST ADAPTER CHECK FAILED", error.message);
}


// Frontend workflow-gate regression checks.
try {
  const generateHtml = fs.readFileSync(path.join(root, "frontend/pages/generate.html"), "utf8");
  const analyzeHtml = fs.readFileSync(path.join(root, "frontend/pages/analyze.html"), "utf8");
  const reviewHtml = fs.readFileSync(path.join(root, "frontend/pages/review.html"), "utf8");
  const navJs = fs.readFileSync(path.join(root, "frontend/assets/js/nav.js"), "utf8");
  const reviewJs = fs.readFileSync(path.join(root, "frontend/assets/js/review.js"), "utf8");
  const apiJs = fs.readFileSync(path.join(root, "frontend/assets/js/api.js"), "utf8");
  const serverJs = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");

  if (/href=["']review\.html["']/.test(generateHtml)) {
    failed = true;
    console.error("WORKFLOW GATE FAILED", "Generate page must not link directly to AI Review");
  }
  if (/href=["']editor\.html["']/.test(analyzeHtml)) {
    failed = true;
    console.error("WORKFLOW GATE FAILED", "Analyze page must not link directly to Human Confirm");
  }
  if (!reviewHtml.includes('id="continueHumanBtn"')) {
    failed = true;
    console.error("WORKFLOW GATE FAILED", "Review page is missing the gated Human Confirm link");
  }
  if (!navJs.includes("guardPage") || !navJs.includes("requireAnalysisBeforeReview")) {
    failed = true;
    console.error("WORKFLOW GATE FAILED", "nav.js is missing sequential page guards");
  }
  if (!reviewJs.includes("DAO_MODELS.getCatalog(true)")) {
    failed = true;
    console.error("REVIEW INIT CHECK FAILED", "review.js must force-refresh the model catalog during initialization");
  }
  if (!apiJs.includes('cache: "no-store"') || !serverJs.includes('app.disable("etag")')) {
    failed = true;
    console.error("API CACHE CHECK FAILED", "Frontend/backend must disable JSON API caching for workflow initialization");
  } else {
    console.log("OK sequential workflow gates");
    console.log("OK review initialization cache policy");
  }
} catch (error) {
  failed = true;
  console.error("WORKFLOW REGRESSION CHECK FAILED", error.message);
}


// Pre-compilation source-intent regression checks.
try {
  const { buildCapabilityRegistry } = require(path.join(root, "backend/proposal/capabilityRegistry"));
  const { validateSourceIntent } = require(path.join(root, "backend/proposal/sourceIntentGuard"));
  const registry = buildCapabilityRegistry();
  const factory = registry.find(item => item.id === "factory.deployContract");

  const omitted = validateSourceIntent({
    sourceText: "Deploy SimpleCounter through DAOContractFactory using the supplied bytecode and salt.",
    registry
  });
  const malformed = validateSourceIntent({
    sourceText: "Deploy SimpleCounter through DAOContractFactory at 0x1232343 for two times.",
    registry
  });
  const wrongValid = validateSourceIntent({
    sourceText: "Deploy SimpleCounter through DAOContractFactory at 0x1111111111111111111111111111111111111111.",
    registry
  });
  const correct = validateSourceIntent({
    sourceText: `Deploy SimpleCounter through DAOContractFactory at ${factory.address}.`,
    registry
  });

  if (!omitted.valid || malformed.valid || wrongValid.valid || !correct.valid) {
    failed = true;
    console.error("SOURCE INTENT GUARD FAILED", {
      omitted: omitted.valid,
      malformed: malformed.valid,
      wrongValid: wrongValid.valid,
      correct: correct.valid
    });
  } else {
    console.log("OK pre-compilation source-intent guard");
  }
} catch (error) {
  failed = true;
  console.error("SOURCE INTENT GUARD CHECK FAILED", error.message);
}

// Reviewer-role and source-fidelity UI/prompt checks.
try {
  const reviewJs = fs.readFileSync(path.join(root, "frontend/assets/js/review.js"), "utf8");
  const reviewerEngine = fs.readFileSync(path.join(root, "backend/review/reviewerEngine.js"), "utf8");
  const promptTemplates = JSON.parse(fs.readFileSync(path.join(root, "config/prompt-templates.json"), "utf8"));
  if (!reviewJs.includes("FALLBACK_REVIEW_PROFILES") || !reviewJs.includes("intent-fidelity")) {
    failed = true;
    console.error("REVIEWER ROLE CHECK FAILED", "Review UI must expose usable reviewer roles even if public profile config is unavailable");
  } else if (!reviewerEngine.includes("sourceIntentConsistency") || !reviewerEngine.includes("buildReviewEvidencePacket")) {
    failed = true;
    console.error("SOURCE REVIEW CHECK FAILED", "Reviewer engine must include compact deterministic source-intent consistency evidence");
  } else if (!(promptTemplates.review?.rules || []).some(rule => /natural-language.*authoritative/i.test(rule))) {
    failed = true;
    console.error("SOURCE REVIEW CHECK FAILED", "Review prompt rules must make original natural-language intent authoritative");
  } else {
    console.log("OK reviewer roles + source-intent fidelity review");
  }
} catch (error) {
  failed = true;
  console.error("REVIEWER ROLE/SOURCE REVIEW CHECK FAILED", error.message);
}


// Human Confirm authority regression checks (v1.0).
try {
  const editorHtml = fs.readFileSync(path.join(root, "frontend/pages/editor.html"), "utf8");
  const editorJs = fs.readFileSync(path.join(root, "frontend/assets/js/editor.js"), "utf8");
  const proposalEditor = fs.readFileSync(path.join(root, "backend/proposal/editor.js"), "utf8");
  const workflowRoute = fs.readFileSync(path.join(root, "backend/routes/workflow.js"), "utf8");
  const app = JSON.parse(fs.readFileSync(path.join(root, "config/app.config.json"), "utf8"));

  const rawEditorFields = [
    'id="finalGovernorOverridePanel"',
    'id="descriptionInput"',
    'id="governorTargetsInput"',
    'id="governorValuesInput"',
    'id="governorCalldatasInput"',
    'id="applyGovernorOverrideBtn"'
  ];

  if (rawEditorFields.some(token => !editorHtml.includes(token))) {
    failed = true;
    console.error("HUMAN AUTHORITY CHECK FAILED", "Human Confirm must expose the exact Governor proposal fields");
  } else if (!editorJs.includes('/api/proposal/human-override') || !proposalEditor.includes('applyHumanGovernorOverride')) {
    failed = true;
    console.error("HUMAN AUTHORITY CHECK FAILED", "Exact Governor override endpoint/service is missing");
  } else if (!workflowRoute.includes('router.post("/proposal/human-override"')) {
    failed = true;
    console.error("HUMAN AUTHORITY CHECK FAILED", "workflow.js is missing /proposal/human-override");
  } else if (app.workflow?.reviewResultOverride?.requireWrittenReason !== false ||
             app.workflow?.humanEditOverride?.requireWrittenReason !== false) {
    failed = true;
    console.error("HUMAN BYPASS CHECK FAILED", "Human review/edit bypass notes must be optional in v1.0");
  } else if (!editorJs.includes('HUMAN_FINAL_GOVERNOR_OVERRIDE')) {
    failed = true;
    console.error("HUMAN AUTHORITY CHECK FAILED", "Submission audit path HUMAN_FINAL_GOVERNOR_OVERRIDE is missing");
  } else {
    console.log("OK Human Confirm final Governor authority override");
    console.log("OK Human Confirm AI-review bypass without hidden reason blocker");
  }
} catch (error) {
  failed = true;
  console.error("HUMAN CONFIRM REGRESSION CHECK FAILED", error.message);
}


// v1.0 horizontal capability expansion checks.
try {
  const elements = JSON.parse(fs.readFileSync(path.join(root, "config/proposal-elements.json"), "utf8"));
  const templates = JSON.parse(fs.readFileSync(path.join(root, "config/contract-type-templates.json"), "utf8"));
  const ids = new Set((elements.capabilities || []).map(item => item.id));
  const requiredCapabilities = [
    "treasury.batchTransferETH",
    "governor.setVotingDelay",
    "governor.setVotingPeriod",
    "governor.setProposalThreshold",
    "governor.updateQuorumNumerator",
    "timelock.updateDelay",
    "timelock.grantRole",
    "timelock.revokeRole"
  ];
  const missingCapabilities = requiredCapabilities.filter(id => !ids.has(id));
  if (missingCapabilities.length) {
    failed = true;
    console.error("V1.0 CAPABILITY CHECK FAILED", `Missing: ${missingCapabilities.join(", ")}`);
  } else if (!(templates.templates || []).some(item => item.templateId === "upgrade.uupsUpgradeToAndCall") ||
             !(templates.templates || []).some(item => item.templateId === "administration.pause") ||
             !(templates.templates || []).some(item => item.templateId === "nft.erc721SafeTransferFrom")) {
    failed = true;
    console.error("V1.0 TEMPLATE CHECK FAILED", "Expected administration, upgrade and NFT templates");
  } else {
    console.log("OK v1.0 built-in capability expansion");
    console.log("OK v1.0 registered contract-type templates");
  }
} catch (error) {
  failed = true;
  console.error("V1.0 CAPABILITY CONFIG CHECK FAILED", error.message);
}



// v1.0 atomic batch-ETH regression checks.
try {
  const treasurySol = fs.readFileSync(path.join(root, "contracts/Treasury.sol"), "utf8");
  const proposalElements = JSON.parse(fs.readFileSync(path.join(root, "config/proposal-elements.json"), "utf8"));
  const validatorJs = fs.readFileSync(path.join(root, "backend/proposal/validator.js"), "utf8");
  const batch = proposalElements.capabilities.find(item => item.id === "treasury.batchTransferETH");

  if (!treasurySol.includes("function batchTransferETH(")) {
    failed = true;
    console.error("ATOMIC BATCH ETH CHECK FAILED", "Treasury.sol must implement batchTransferETH");
  } else if (!treasurySol.includes("INSUFFICIENT_ETH_BALANCE") || !treasurySol.includes("ETH_TRANSFER_FAILED")) {
    failed = true;
    console.error("ATOMIC BATCH ETH CHECK FAILED", "Treasury batch must precheck aggregate balance and revert on failed recipient");
  } else if (!batch || batch.signature !== "batchTransferETH(address[],uint256[])" || batch.expansion) {
    failed = true;
    console.error("ATOMIC BATCH ETH CHECK FAILED", "treasury.batchTransferETH must encode one direct Treasury call and must not use macro expansion");
  } else if (!validatorJs.includes('"ether-amount-list"') || !validatorJs.includes('"token-amount-list"')) {
    failed = true;
    console.error("BATCH AMOUNT DECIMAL CHECK FAILED", "Validator must allow decimal human-unit values in token/ether amount lists");
  } else {
    console.log("OK atomic Treasury batch ETH capability");
    console.log("OK decimal token/ETH list validation");
  }
} catch (error) {
  failed = true;
  console.error("ATOMIC BATCH ETH REGRESSION CHECK FAILED", error.message);
}


// v1.0 automated AI pipeline diagnostic-report checks.
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const models = JSON.parse(fs.readFileSync(path.join(root, "config/models.config.json"), "utf8"));
  const runner = fs.readFileSync(path.join(root, "scripts/run-yanfu-ai-pipeline-test.js"), "utf8");
  const cases = JSON.parse(fs.readFileSync(path.join(root, "test/auto/yanfu-ai-pipeline-cases.json"), "utf8"));
  const requiredModelIds = [
    "modelscope:qwen3.5-27b",
    "modelscope:qwen3.5-35b-a3b",
    "modelscope:deepseek-v4-pro-0813"
  ];

  if (packageJson.version !== fs.readFileSync(path.join(root, "VERSION"), "utf8").trim()) {
    failed = true;
    console.error("AUTO TEST VERSION CHECK FAILED", `package.json must match VERSION, received ${packageJson.version}`);
  }
  if (packageJson.scripts?.["test:auto-ai"] !== "node scripts/run-yanfu-ai-pipeline-test.js") {
    failed = true;
    console.error("AUTO TEST SCRIPT CHECK FAILED", "package.json must define npm run test:auto-ai");
  }
  for (const modelId of requiredModelIds) {
    if (!(models.models || []).some(item => item.id === modelId)) {
      failed = true;
      console.error("AUTO TEST MODEL CHECK FAILED", `Missing fixed test model ${modelId}`);
    }
  }
  const requiredRunnerFragments = [
    'const COMPILE_MODEL = "modelscope:qwen3.5-35b-a3b"',
    'const ANALYZE_MODEL = "modelscope:qwen3.5-35b-a3b"',
    'model: "modelscope:qwen3.5-27b", profileId: "general-governance"',
    'model: "modelscope:qwen3.5-35b-a3b", profileId: "treasury-governance"',
    'model: OPTIONAL_THIRD_REVIEWER || "modelscope:deepseek-v4-pro-0813", profileId: "intent-fidelity"',
    'REPORT_SCHEMA_VERSION = 2',
    'Primary HTML report:',
    'Diagnostic JSON    :',
    'CSV summary        :',
    'Compile Expected',
    'Review Expected'
  ];
  if (requiredRunnerFragments.some(fragment => !runner.includes(fragment))) {
    failed = true;
    console.error("AUTO TEST PROFILE CHECK FAILED", "Fixed AI profile or v1.0 diagnostic-report schema is missing from runner");
  }
  if (!Array.isArray(cases.cases)) {
    failed = true;
    console.error("AUTO TEST INPUT CHECK FAILED", "test/auto/yanfu-ai-pipeline-cases.json must contain cases[]");
  } else {
    console.log("OK v1.0 AI pipeline diagnostic-report profile");
  }
} catch (error) {
  failed = true;
  console.error("AUTO TEST CHECK FAILED", error.message);
}



// v1.0 prompt-alignment and reviewer-reliability regression checks.
try {
  const prompts = JSON.parse(fs.readFileSync(path.join(root, "config/prompt-templates.json"), "utf8"));
  const generatorJs = fs.readFileSync(path.join(root, "backend/proposal/generator.js"), "utf8");
  const reviewerJs = fs.readFileSync(path.join(root, "backend/review/reviewerEngine.js"), "utf8");

  const generationRules = (prompts.generation?.rules || []).join("\n");
  const reviewRules = (prompts.review?.rules || []).join("\n");
  if (!/one governance proposal may contain multiple semantic operations/i.test(generationRules)) {
    failed = true;
    console.error("v1.0 PROMPT CHECK FAILED", "Generation prompt must distinguish one proposal from one action");
  } else if (!/underfunded/i.test(generationRules) || !/Analyze and Review/i.test(generationRules)) {
    failed = true;
    console.error("v1.0 PROMPT CHECK FAILED", "Generation prompt must defer execution-risk/balance gating to Analyze/Review");
  } else if (!/human-readable token amounts/i.test(generationRules)) {
    failed = true;
    console.error("v1.0 PROMPT CHECK FAILED", "Generation prompt must define token-symbol amounts as human units");
  } else if (!generatorJs.includes("COMPILATION-STAGE CONTRACT") || !generatorJs.includes("compilationStageContract")) {
    failed = true;
    console.error("v1.0 PROMPT CHECK FAILED", "Generator must inject the dynamic compilation-stage contract");
  } else if (!reviewerJs.includes("buildReviewEvidencePacket") || !reviewerJs.includes("STRICT FORMAT RETRY")) {
    failed = true;
    console.error("v1.0 REVIEW CHECK FAILED", "Reviewer engine must use compact evidence and one strict-format retry");
  } else if (!/Never invent a hard-coded capability restriction/i.test(reviewRules) ||
             !/Strong evidence-grounded concerns can justify NEEDS_CHANGES or REJECT/i.test(reviewRules) ||
             !/NOT sufficient grounds to APPROVE/i.test(reviewRules)) {
    failed = true;
    console.error("v1.0 REVIEW CHECK FAILED", "Reviewer prompt must distinguish schema compliance from substantiated role-policy objections");
  } else {
    console.log("OK v1.0 compilation-stage prompt contract");
    console.log("OK v1.0 compact reviewer evidence + JSON-format retry");
  }
} catch (error) {
  failed = true;
  console.error("v1.0 PROMPT/REVIEW REGRESSION CHECK FAILED", error.message);
}


// v1.0 targeted regression checks: balance-aware simulation, reviewer transient
// retry, long-running auto-test HTTP client, and red failed-case HTML highlighting.
try {
  const simulatorJs = fs.readFileSync(path.join(root, "backend/chain/simulator.js"), "utf8");
  const reviewerJs = fs.readFileSync(path.join(root, "backend/review/reviewerEngine.js"), "utf8");
  const runnerJs = fs.readFileSync(path.join(root, "scripts/run-yanfu-ai-pipeline-test.js"), "utf8");
  const workflowJs = fs.readFileSync(path.join(root, "backend/routes/workflow.js"), "utf8");
  const cases = JSON.parse(fs.readFileSync(path.join(root, "test/auto/yanfu-ai-pipeline-cases.json"), "utf8"));

  if (!simulatorJs.includes("treasuryBalancePreflight") ||
      !simulatorJs.includes("Treasury ETH") ||
      !simulatorJs.includes("Treasury token")) {
    failed = true;
    console.error("v1.0 SIMULATION CHECK FAILED", "Simulator must perform deterministic Treasury ETH/token balance preflight");
  } else if (!reviewerJs.includes("isTransientReviewerTransportError") ||
             !reviewerJs.includes("generateWithTransientRetry") ||
             !reviewerJs.includes("transportRetryCount")) {
    failed = true;
    console.error("v1.0 REVIEW RELIABILITY CHECK FAILED", "Reviewer must retry one transient provider/network failure");
  } else if (!runnerJs.includes('const axios = require("axios")') ||
             !runnerJs.includes("axios.request") ||
             !runnerJs.includes("row-fail") ||
             !runnerJs.includes("case-fail")) {
    failed = true;
    console.error("v1.0 AUTO TEST CHECK FAILED", "Runner must use long-timeout axios requests and red failed-case HTML styling");
  } else if (!workflowJs.includes("simulation?.allSuccessful === false")) {
    failed = true;
    console.error("v1.0 LOGGING CHECK FAILED", "Analysis route logging must use simulation.allSuccessful");
  } else {
    console.log("OK v1.0 Treasury balance-aware simulation");
    console.log("OK v1.0 reviewer transient transport retry");
    console.log("OK v1.0 auto-test long HTTP wait + red failure highlighting");
  }
} catch (error) {
  failed = true;
  console.error("v1.0 TARGETED REGRESSION CHECK FAILED", error.message);
}


// v1.0 targeted regression checks: analyzer transient provider retry and
// strengthened reviewer transport retry/backoff. Test expectations are preserved.
try {
  const analyzerJs = fs.readFileSync(path.join(root, "backend/proposal/analyzer.js"), "utf8");
  const reviewerJs = fs.readFileSync(path.join(root, "backend/review/reviewerEngine.js"), "utf8");
  const cases = JSON.parse(fs.readFileSync(path.join(root, "test/auto/yanfu-ai-pipeline-cases.json"), "utf8"));

  if (!analyzerJs.includes("isTransientAnalysisTransportError") ||
      !analyzerJs.includes("generateAnalysisJsonWithRetry") ||
      !analyzerJs.includes("AI_ANALYSIS_RETRY_DELAY_MS") ||
      !analyzerJs.includes("transportRetryCount")) {
    failed = true;
    console.error("v1.0 ANALYSIS RELIABILITY CHECK FAILED", "Analyzer must retry one transient provider/network failure");
  } else if (!reviewerJs.includes("AI_REVIEW_TRANSPORT_RETRIES") ||
             !reviewerJs.includes("Math.pow(2, attempt)") ||
             !reviewerJs.includes("socket disconnected") ||
             !reviewerJs.includes("ERR_BAD_RESPONSE")) {
    failed = true;
    console.error("v1.0 REVIEW RELIABILITY CHECK FAILED", "Reviewer retry must support bounded multi-attempt exponential backoff for transient provider errors");
  } else if (cases.targetYanFuVersion !== "1.0.0") {
    failed = true;
    console.error("v1.0 CASE TARGET CHECK FAILED", `Expected targetYanFuVersion=1.0.0, received ${cases.targetYanFuVersion}`);
  } else {
    console.log("OK v1.0 analyzer transient transport retry");
    console.log("OK v1.0 reviewer retry/backoff hardening");
    console.log("OK v1.0 regression expectations preserved");
  }
} catch (error) {
  failed = true;
  console.error("v1.0 TARGETED REGRESSION CHECK FAILED", error.message);
}

// v1.0 dependency-free multi-reviewer and provider integration regression.
try {
  const { execFileSync } = require("child_process");
  const output = execFileSync(process.execPath, [path.join(root, "scripts/test-review-models.js")], {
    cwd: root, encoding: "utf8", timeout: 30000
  });
  console.log(output.trim());
} catch (error) {
  failed = true;
  console.error("v1.0 REVIEW MODEL CHECK FAILED", error.stack || error.message);
}

// v1.0 regression: Human Authority opt-in, rewrite acknowledgements,
// stale-review handling and fingerprint-sensitive submission gating.
try {
  require("./test-human-authority");
  console.log("OK v1.0 Human Authority confirmation gates");
} catch (error) {
  failed = true;
  console.error("v1.0 HUMAN AUTHORITY CHECK FAILED", error.stack || error.message);
}

// Offline hotfix regression: role-specific prompts, authoritative decoded payload,
// historical semantic-plan isolation and review-report presentation.
try {
  const { execFileSync } = require("child_process");
  const output = execFileSync(process.execPath, [path.join(root, "scripts/test-review-roles.js")], {
    cwd: root, encoding: "utf8", timeout: 30000
  });
  console.log(output.trim());
} catch (error) {
  failed = true;
  console.error("REVIEW ROLE FOCUS HOTFIX TEST FAILED", error.stack || error.message);
}

if (failed) process.exitCode = 1;

// v1.0 review policy autonomy: independent risk decisions must not be coerced into technical-compliance approval.
try {
  const {execFileSync} = require("child_process");
  const output = execFileSync(process.execPath, [path.join(root,"scripts/test-review-policy.js")], {
    cwd: root, encoding:"utf8",timeout:30000
  });
  console.log(output.trim());
} catch (error) {
  process.exitCode = 1;
  console.error("REVIEW POLICY AUTONOMY CHECK FAILED",error.stack || error.message);
}

// v1.0 regression: review provenance must not be confused with Governor
// execution consistency. Run even when optional ethers/Hardhat are absent.
try {
  const {execFileSync} = require("child_process");
  const output = execFileSync(process.execPath, [path.join(root, "scripts/test-reencoding.js")], {
    cwd:root, encoding:"utf8",timeout:30000
  });
  console.log(output.trim());
} catch (error) {
  process.exitCode = 1;
  console.error("v1.0 DETERMINISTIC REENCODING CHECK FAILED",error.stack || error.message);
}

// v1.0 smoke regression: exact chain-verified token symbol only; review provider failures remain explicit.
try {
  const {execFileSync} = require("child_process");
  console.log(execFileSync(process.execPath,[path.join(root,"scripts/test-compiler-diagnostics.js")],{cwd:root,encoding:"utf8",timeout:30000}).trim());
} catch (error) {
  process.exitCode=1;
  console.error("v1.0 SMOKE COMPILER/REVIEW DIAGNOSTICS CHECK FAILED",error.stack||error.message);
}
