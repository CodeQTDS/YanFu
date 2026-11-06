"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const ROOT = path.resolve(__dirname, "..");
const CASE_FILE = process.env.YANFU_TEST_CASE_FILE
  ? path.resolve(ROOT, process.env.YANFU_TEST_CASE_FILE)
  : path.join(ROOT, "test/auto/yanfu-ai-pipeline-cases.json");
const TEST_TAG = String(process.env.YANFU_TEST_TAG || "").trim();
const RESULT_DIR = path.join(ROOT, "test/auto/results");
const REPORT_SCHEMA_VERSION = 2;

const APP_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/app.config.json"), "utf8"));
const API_BASE = String(
  process.env.YANFU_TEST_API_BASE || APP_CONFIG.frontend?.apiBaseUrl || "http://localhost:3000"
).replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.YANFU_TEST_TIMEOUT_MS || 1_200_000);

const COMPILE_MODEL = "modelscope:qwen3.5-35b-a3b";
const ANALYZE_MODEL = "modelscope:qwen3.5-35b-a3b";
// Override only the third reviewer for an isolated provider comparison.
// Defaults remain fixed so historical AI regression results stay comparable.
const OPTIONAL_THIRD_REVIEWER = String(process.env.YANFU_TEST_REVIEWER_3 || "").trim();
const REVIEWERS = Object.freeze([
  Object.freeze({ model: "modelscope:qwen3.5-27b", profileId: "general-governance" }),
  Object.freeze({ model: "modelscope:qwen3.5-35b-a3b", profileId: "treasury-governance" }),
  Object.freeze({ model: OPTIONAL_THIRD_REVIEWER || "modelscope:deepseek-v4-pro-0813", profileId: "intent-fidelity" })
]);

class HttpError extends Error {
  constructor(message, { status = null, body = null, method = null, pathname = null, durationMs = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.method = method;
    this.pathname = pathname;
    this.durationMs = durationMs;
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function runIdentity() {
  const now = new Date();
  const stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("") +
    "_" + [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return {
    runId: `${stamp}_${random}`,
    baseName: `yanfu_ai_pipeline_${stamp}_${random}`,
    startedAt: now.toISOString()
  };
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function byteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch (_) {
    return null;
  }
}

function redactKey(key) {
  return /api[_-]?key|authorization|private[_-]?key|password|secret/i.test(String(key || ""));
}

function sanitizeForReport(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForReport(item, seen));
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactKey(key) ? "[REDACTED]" : sanitizeForReport(item, seen);
  }
  return out;
}

function errorDetails(error) {
  if (!error) return null;
  return sanitizeForReport({
    name: error.name || "Error",
    message: error.message || String(error),
    httpStatus: error.status ?? null,
    method: error.method ?? null,
    endpoint: error.pathname ?? null,
    durationMs: error.durationMs ?? null,
    code: error.body?.code ?? error.code ?? null,
    responseBody: error.body ?? null,
    stack: error.stack || null
  });
}

function csv(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function truncate(value, max = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pretty(value) {
  return JSON.stringify(sanitizeForReport(value), null, 2);
}

function normalizeStageExpected(raw, fallbackSuccess = true) {
  const expected = { ...(raw || {}) };
  if (expected.success === undefined) expected.success = fallbackSuccess;
  return expected;
}

function normalizedExpectations(testCase) {
  const compile = normalizeStageExpected(testCase.expected?.compile, true);
  const analyze = compile.success === false
    ? { run: false, reason: "Compilation is expected to reject this case." }
    : { run: true, ...normalizeStageExpected(testCase.expected?.analyze, true) };
  const review = compile.success === false || analyze.success === false
    ? { run: false, reason: compile.success === false ? "Compilation is expected to reject this case." : "Analyzation is expected to fail this case." }
    : {
        run: true,
        ...normalizeStageExpected(testCase.expected?.review, true),
        reviewerCount: REVIEWERS.length,
        reviewerAssignments: REVIEWERS
      };
  return { compile, analyze, review };
}

function loadCases() {
  if (!fs.existsSync(CASE_FILE)) throw new Error(`Input file not found: ${CASE_FILE}`);
  const parsed = JSON.parse(fs.readFileSync(CASE_FILE, "utf8"));
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Input file must contain a non-empty cases[] array");
  }
  const selected = TEST_TAG ? parsed.cases.filter(item => (item.tags || []).includes(TEST_TAG)) : parsed.cases;
  if (!selected.length) throw new Error(`No cases match YANFU_TEST_TAG=${TEST_TAG}`);
  return selected.map((item, index) => {
    const testCase = {
      id: String(item.id || `case-${index + 1}`),
      description: String(item.description || ""),
      text: String(item.text || "").trim(),
      enabled: item.enabled !== false,
      expected: item.expected || {}
    };
    testCase.normalizedExpected = normalizedExpectations(testCase);
    return testCase;
  });
}

async function requestJson(method, pathname, body) {
  const started = Date.now();
  const requestBytes = body === undefined ? 0 : byteLength(body);

  try {
    const response = await axios.request({
      method,
      url: `${API_BASE}${pathname}`,
      data: body,
      timeout: REQUEST_TIMEOUT_MS,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      validateStatus: () => true,
      transitional: { clarifyTimeoutError: true },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const durationMs = Date.now() - started;
    const data = response.data ?? {};
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    const responseBytes = Buffer.byteLength(raw || "", "utf8");

    if (response.status < 200 || response.status >= 300 || data?.success === false) {
      const message = data?.error || data?.message || `HTTP ${response.status}`;
      const error = new HttpError(message, {
        status: response.status,
        body: data,
        method,
        pathname,
        durationMs
      });
      error.requestBytes = requestBytes;
      error.responseBytes = responseBytes;
      throw error;
    }

    return {
      data,
      durationMs,
      status: response.status,
      method,
      pathname,
      requestBytes,
      responseBytes
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (axios.isAxiosError(error)) {
      const timedOut = ["ECONNABORTED", "ETIMEDOUT"].includes(error.code);
      const wrapped = new HttpError(
        timedOut ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms` : error.message,
        {
          status: error.response?.status ?? null,
          body: error.response?.data ?? null,
          method,
          pathname,
          durationMs: Date.now() - started
        }
      );
      wrapped.code = error.code || null;
      wrapped.requestBytes = requestBytes;
      wrapped.responseBytes = byteLength(error.response?.data);
      throw wrapped;
    }
    throw error;
  }
}

function compileFacts(proposal) {
  const operations = Array.isArray(proposal?.plan?.operations) ? proposal.plan.operations : [];
  const actions = Array.isArray(proposal?.actions) ? proposal.actions : [];
  return {
    success: true,
    fingerprint: proposal?.fingerprint || null,
    planStatus: proposal?.plan?.status || null,
    semanticCapabilities: operations.map(item => item.capabilityId).filter(Boolean),
    semanticOperations: operations.length,
    executableActions: actions.length,
    description: proposal?.description || null,
    unresolved: proposal?.plan?.unresolved || [],
    assumptions: proposal?.plan?.assumptions || [],
    targets: proposal?.targets || [],
    values: proposal?.values || [],
    actions: actions.map((action, index) => ({
      index,
      capabilityId: action.capabilityId || null,
      sourceCapabilityId: action.sourceCapabilityId || null,
      pack: action.pack || null,
      contractType: action.contractType || null,
      target: action.target || proposal?.targets?.[index] || null,
      functionName: action.functionName || null,
      functionSignature: action.functionSignature || null,
      arguments: action.arguments || null,
      encodedArguments: action.encodedArguments || null,
      value: action.value ?? proposal?.values?.[index] ?? null,
      calldataSelector: String(action.calldata || proposal?.calldatas?.[index] || "").slice(0, 10),
      calldataBytes: Math.max(0, (String(action.calldata || proposal?.calldatas?.[index] || "0x").length - 2) / 2)
    }))
  };
}

function assertCompile(proposal, expected = {}) {
  const errors = [];
  const facts = compileFacts(proposal);
  if (Array.isArray(expected.capabilities)) {
    for (const capability of expected.capabilities) {
      if (!facts.semanticCapabilities.includes(capability)) errors.push(`missing capability ${capability}`);
    }
  }
  if (expected.executableActions !== undefined && facts.executableActions !== Number(expected.executableActions)) {
    errors.push(`expected ${expected.executableActions} executable action(s), got ${facts.executableActions}`);
  }
  if (expected.semanticOperations !== undefined && facts.semanticOperations !== Number(expected.semanticOperations)) {
    errors.push(`expected ${expected.semanticOperations} semantic operation(s), got ${facts.semanticOperations}`);
  }
  if (Array.isArray(expected.operationArguments)) {
    if (expected.operationArguments.length !== (proposal?.plan?.operations || []).length) {
      errors.push(`expected ${expected.operationArguments.length} operation argument group(s), got ${(proposal?.plan?.operations || []).length}`);
    } else {
      const normalized = value => {
        if (Array.isArray(value)) return value.map(normalized);
        if (value === null || value === undefined) return value;
        const string = String(value).trim();
        if (/^0x[0-9a-fA-F]{40}$/.test(string)) return string.toLowerCase();
        if (/^\d+(?:\.\d+)?$/.test(string)) {
          const [whole, decimal = ""] = string.split(".");
          const nwhole = whole.replace(/^0+(?=\d)/, "") || "0";
          const ndecimal = decimal.replace(/0+$/, "");
          return ndecimal ? `${nwhole}.${ndecimal}` : nwhole;
        }
        return string;
      };
      expected.operationArguments.forEach((wanted, index) => {
        const got = proposal.plan.operations[index]?.arguments || {};
        for (const [key, value] of Object.entries(wanted || {})) {
          const actual = got[key];
          if (JSON.stringify(normalized(actual)) !== JSON.stringify(normalized(value))) {
            errors.push(`operation[${index}].arguments.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
          }
        }
      });
    }
  }
  const targets = proposal?.targets || [];
  const values = proposal?.values || [];
  const calldatas = proposal?.calldatas || [];
  if (!(Array.isArray(targets) && Array.isArray(values) && Array.isArray(calldatas)) ||
      targets.length !== facts.executableActions || values.length !== targets.length || calldatas.length !== targets.length ||
      calldatas.some(c => typeof c !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(c))) {
    errors.push("Governor targets/values/calldatas must align with executable actions and contain valid calldata hex");
  }
  return { errors, facts };
}

function analysisFacts(analysis) {
  const simulationResults = Array.isArray(analysis?.simulation?.results) ? analysis.simulation.results : [];
  const findings = Array.isArray(analysis?.actionAnalysis?.findings) ? analysis.actionAnalysis.findings : [];
  return {
    success: true,
    model: analysis?.model || null,
    risk: String(analysis?.riskScore?.level || analysis?.risk || analysis?.aiRisk || "UNKNOWN"),
    riskScore: analysis?.riskScore?.score ?? null,
    aiRisk: analysis?.aiRisk || null,
    simulationSuccess: analysis?.simulation?.allSuccessful !== false,
    simulationCaller: analysis?.simulation?.caller || null,
    simulationResults: simulationResults.map(item => ({
      index: item.index,
      target: item.target,
      success: item.success,
      blocker: item.blocker,
      error: item.error || null,
      returnData: item.returnData || null
    })),
    simulationFailures: simulationResults.filter(item => item.success === false).map(item => ({
      index: item.index,
      target: item.target,
      blocker: item.blocker,
      error: item.error || null
    })),
    findingCount: findings.length,
    findings,
    hasBlockingFinding: Boolean(analysis?.actionAnalysis?.hasBlockingFinding),
    governanceChanges: analysis?.actionAnalysis?.governanceChanges || [],
    authorityChanges: analysis?.actionAnalysis?.authorityChanges || [],
    treasury: analysis?.actionAnalysis?.treasury || null,
    summary: analysis?.summary || "",
    advice: analysis?.advice || "",
    observations: analysis?.observations || []
  };
}

function assertAnalysis(analysis, expected = {}) {
  const errors = [];
  const facts = analysisFacts(analysis);
  if (expected.riskLevel && facts.risk !== expected.riskLevel) {
    errors.push(`expected risk ${expected.riskLevel}, got ${facts.risk}`);
  }
  if (Array.isArray(expected.riskIn) && !expected.riskIn.includes(facts.risk)) {
    errors.push(`risk ${facts.risk} not in [${expected.riskIn.join(", ")}]`);
  }
  if (expected.simulationSuccess !== undefined && facts.simulationSuccess !== Boolean(expected.simulationSuccess)) {
    errors.push(`expected simulationSuccess=${Boolean(expected.simulationSuccess)}, got ${facts.simulationSuccess}`);
  }
  return { errors, facts };
}

function reviewFacts(reviewSession) {
  const reviews = Array.isArray(reviewSession?.reviews) ? reviewSession.reviews : [];
  return {
    success: true,
    sessionId: reviewSession?.sessionId || null,
    proposalFingerprint: reviewSession?.proposalFingerprint || null,
    verdict: String(reviewSession?.aggregate?.verdict || "UNKNOWN"),
    agreement: String(reviewSession?.aggregate?.agreement || "UNKNOWN"),
    nextAction: reviewSession?.aggregate?.nextAction || reviewSession?.loopState?.nextAction || null,
    reviewerCount: reviews.length,
    reviewerErrors: reviews.filter(item => item?.status === "ERROR").map(item => ({
      model: item.model,
      profile: item.profile?.id || null,
      error: item.error || null
    })),
    reviewerSelection: reviewSession?.reviewerSelection || [],
    reviewers: reviews.map(item => ({
      reviewerId: item.reviewerId || null,
      status: item.status || "COMPLETED",
      model: item.model || null,
      profileId: item.profile?.id || null,
      profileLabel: item.profile?.label || null,
      verdict: item.verdict || item.status || "UNKNOWN",
      confidence: item.confidence ?? null,
      workSummary: item.workSummary || "",
      findings: item.findings || [],
      recommendedAdjustments: item.recommendedAdjustments || [],
      revisedNaturalLanguage: item.revisedNaturalLanguage || null,
      error: item.error || null
    })),
    deterministicBlockers: reviewSession?.sharedEvidence?.deterministic?.findings || [],
    aggregateSummary: reviewSession?.aggregate?.summary || reviewSession?.aggregate?.workSummary || null,
    recommendedRevision: reviewSession?.aggregate?.recommendedRevision || null
  };
}

function assertReview(reviewSession, expected = {}) {
  const errors = [];
  const facts = reviewFacts(reviewSession);
  if (facts.reviewerCount !== REVIEWERS.length) {
    errors.push(`expected ${REVIEWERS.length} reviewer results, got ${facts.reviewerCount}`);
  }
  if (facts.reviewerErrors.length) {
    errors.push(`${facts.reviewerErrors.length} reviewer(s) failed: ${facts.reviewerErrors.map(item => item.model).join(", ")}`);
  }
  const selected = reviewSession?.reviewerSelection || [];
  for (const spec of REVIEWERS) {
    if (!selected.some(item => item.model === spec.model && item.profileId === spec.profileId)) {
      errors.push(`missing reviewer assignment ${spec.model}/${spec.profileId}`);
    }
  }
  if (expected.verdict && facts.verdict !== expected.verdict) {
    errors.push(`expected verdict ${expected.verdict}, got ${facts.verdict}`);
  }
  if (Array.isArray(expected.verdictIn) && !expected.verdictIn.includes(facts.verdict)) {
    errors.push(`verdict ${facts.verdict} not in [${expected.verdictIn.join(", ")}]`);
  }
  if (expected.agreement && facts.agreement !== expected.agreement) {
    errors.push(`expected agreement ${expected.agreement}, got ${facts.agreement}`);
  }
  return { errors, facts };
}

function expectedFailureMatches(error, expected = {}) {
  if (expected.success !== false) return false;
  if (expected.errorCode) return String(error?.body?.code || "") === String(expected.errorCode);
  return true;
}

function newStage(name, endpoint, expected, modelProfile) {
  return {
    name,
    endpoint,
    modelProfile,
    expected: sanitizeForReport(expected),
    status: "SKIPPED",
    durationMs: 0,
    httpStatus: null,
    requestBytes: null,
    responseBytes: null,
    actual: null,
    assertions: [],
    request: null,
    response: null,
    error: null,
    skipReason: null
  };
}

function markSkipped(stage, reason) {
  stage.status = "SKIPPED";
  stage.skipReason = reason;
  stage.actual = { skipped: true, reason };
}

async function preflight() {
  const startedAt = new Date().toISOString();
  const detail = {
    startedAt,
    status: "PASS",
    checks: {},
    requiredModels: [...new Set([COMPILE_MODEL, ANALYZE_MODEL, ...REVIEWERS.map(item => item.model)])]
  };

  try {
    const health = await requestJson("GET", "/api/health");
    detail.checks.backend = {
      status: "PASS",
      httpStatus: health.status,
      durationMs: health.durationMs,
      response: sanitizeForReport(health.data)
    };
  } catch (error) {
    detail.status = "FAIL";
    detail.checks.backend = { status: "FAIL", error: errorDetails(error) };
    return detail;
  }

  try {
    const chain = await requestJson("GET", "/api/config/chain-context");
    detail.checks.chain = {
      status: "PASS",
      httpStatus: chain.status,
      durationMs: chain.durationMs,
      response: sanitizeForReport(chain.data)
    };
  } catch (error) {
    detail.status = "FAIL";
    detail.checks.chain = { status: "FAIL", error: errorDetails(error) };
    return detail;
  }

  try {
    const modelResponse = await requestJson("GET", "/api/models");
    const models = modelResponse.data.models || [];
    const selected = detail.requiredModels.map(modelId => {
      const item = models.find(model => model.id === modelId);
      return item ? sanitizeForReport(item) : { id: modelId, available: false, status: "NOT_REGISTERED" };
    });
    const unavailable = selected.filter(item => item.available === false || item.status === "NOT_REGISTERED");
    detail.checks.models = {
      status: unavailable.length ? "FAIL" : "PASS",
      httpStatus: modelResponse.status,
      durationMs: modelResponse.durationMs,
      required: selected,
      unavailable
    };
    if (unavailable.length) detail.status = "FAIL";
  } catch (error) {
    detail.status = "FAIL";
    detail.checks.models = { status: "FAIL", error: errorDetails(error) };
  }

  detail.finishedAt = new Date().toISOString();
  return detail;
}

async function runCase(testCase) {
  const started = Date.now();
  const expected = testCase.normalizedExpected;
  const result = {
    caseId: testCase.id,
    description: testCase.description,
    enabled: testCase.enabled,
    input: testCase.text,
    sourceExpected: sanitizeForReport(testCase.expected),
    normalizedExpected: sanitizeForReport(expected),
    overall: "FAIL",
    stopReason: null,
    durationMs: 0,
    proposalFingerprint: null,
    stages: {
      compile: newStage("Compilation", "/api/generate", expected.compile, { model: COMPILE_MODEL }),
      analyze: newStage("Analyzation", "/api/analyze", expected.analyze, { model: ANALYZE_MODEL }),
      review: newStage("AI Review", "/api/review/session", expected.review, { reviewers: REVIEWERS })
    }
  };

  if (!testCase.enabled) {
    result.overall = "SKIPPED";
    result.stopReason = "Test case disabled in input file.";
    markSkipped(result.stages.compile, result.stopReason);
    markSkipped(result.stages.analyze, result.stopReason);
    markSkipped(result.stages.review, result.stopReason);
    return result;
  }

  if (!testCase.text) {
    result.stages.compile.status = "FAIL";
    result.stages.compile.error = { message: "Test case text is empty" };
    result.stopReason = "Compilation could not start because the test input is empty.";
    markSkipped(result.stages.analyze, result.stopReason);
    markSkipped(result.stages.review, result.stopReason);
    result.durationMs = Date.now() - started;
    return result;
  }

  let proposal;
  let analysis;

  // Stage 1: Compile
  {
    const stage = result.stages.compile;
    const requestBody = { text: testCase.text, model: COMPILE_MODEL };
    stage.request = sanitizeForReport(requestBody);
    const stageStarted = Date.now();
    try {
      const response = await requestJson("POST", stage.endpoint, requestBody);
      stage.durationMs = response.durationMs;
      stage.httpStatus = response.status;
      stage.requestBytes = response.requestBytes;
      stage.responseBytes = response.responseBytes;
      stage.response = sanitizeForReport(response.data);
      proposal = response.data.proposal;
      stage.actual = compileFacts(proposal);
      result.proposalFingerprint = stage.actual.fingerprint;

      if (expected.compile.success === false) {
        stage.status = "FAIL";
        stage.assertions.push("Expected compilation to fail, but /api/generate succeeded.");
        result.stopReason = "Compilation expectation mismatch.";
        markSkipped(result.stages.analyze, result.stopReason);
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }

      const assertion = assertCompile(proposal, expected.compile);
      stage.assertions = assertion.errors;
      stage.actual = assertion.facts;
      if (assertion.errors.length) {
        stage.status = "FAIL";
        result.stopReason = `Compilation assertion failed: ${assertion.errors.join("; ")}`;
        markSkipped(result.stages.analyze, result.stopReason);
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }
      stage.status = "PASS";
    } catch (error) {
      stage.durationMs = error.durationMs ?? (Date.now() - stageStarted);
      stage.httpStatus = error.status ?? null;
      stage.requestBytes = error.requestBytes ?? byteLength(requestBody);
      stage.responseBytes = error.responseBytes ?? byteLength(error.body);
      stage.error = errorDetails(error);
      stage.response = sanitizeForReport(error.body || null);
      stage.actual = {
        success: false,
        errorCode: error.body?.code || error.code || null,
        httpStatus: error.status ?? null,
        message: error.message
      };

      if (expectedFailureMatches(error, expected.compile)) {
        stage.status = "PASS_EXPECTED_FAILURE";
        stage.assertions = [];
        result.overall = "PASS";
        result.stopReason = "Compilation rejected the case as expected; later stages intentionally skipped.";
        markSkipped(result.stages.analyze, result.stopReason);
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }

      stage.status = "FAIL";
      stage.assertions.push(`Unexpected compilation failure: ${error.message}`);
      result.stopReason = "Compilation failed unexpectedly.";
      markSkipped(result.stages.analyze, result.stopReason);
      markSkipped(result.stages.review, result.stopReason);
      result.durationMs = Date.now() - started;
      return result;
    }
  }

  // Stage 2: Analyze
  {
    const stage = result.stages.analyze;
    const requestBody = { proposal, model: ANALYZE_MODEL };
    stage.request = sanitizeForReport(requestBody);
    const stageStarted = Date.now();
    try {
      const response = await requestJson("POST", stage.endpoint, requestBody);
      stage.durationMs = response.durationMs;
      stage.httpStatus = response.status;
      stage.requestBytes = response.requestBytes;
      stage.responseBytes = response.responseBytes;
      stage.response = sanitizeForReport(response.data);
      analysis = response.data.analysis;
      stage.actual = analysisFacts(analysis);

      if (expected.analyze.success === false) {
        stage.status = "FAIL";
        stage.assertions.push("Expected analyzation to fail, but /api/analyze succeeded.");
        result.stopReason = "Analyzation expectation mismatch.";
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }

      const assertion = assertAnalysis(analysis, expected.analyze);
      stage.assertions = assertion.errors;
      stage.actual = assertion.facts;
      if (assertion.errors.length) {
        stage.status = "FAIL";
        result.stopReason = `Analyzation assertion failed: ${assertion.errors.join("; ")}`;
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }
      stage.status = "PASS";
    } catch (error) {
      stage.durationMs = error.durationMs ?? (Date.now() - stageStarted);
      stage.httpStatus = error.status ?? null;
      stage.requestBytes = error.requestBytes ?? byteLength(requestBody);
      stage.responseBytes = error.responseBytes ?? byteLength(error.body);
      stage.error = errorDetails(error);
      stage.response = sanitizeForReport(error.body || null);
      stage.actual = {
        success: false,
        errorCode: error.body?.code || error.code || null,
        httpStatus: error.status ?? null,
        message: error.message
      };

      if (expectedFailureMatches(error, expected.analyze)) {
        stage.status = "PASS_EXPECTED_FAILURE";
        result.overall = "PASS";
        result.stopReason = "Analyzation failed as expected; AI Review intentionally skipped.";
        markSkipped(result.stages.review, result.stopReason);
        result.durationMs = Date.now() - started;
        return result;
      }

      stage.status = "FAIL";
      stage.assertions.push(`Unexpected analyzation failure: ${error.message}`);
      result.stopReason = "Analyzation failed unexpectedly.";
      markSkipped(result.stages.review, result.stopReason);
      result.durationMs = Date.now() - started;
      return result;
    }
  }

  // Stage 3: Review
  {
    const stage = result.stages.review;
    const requestBody = {
      proposal,
      analysis,
      reviewers: REVIEWERS,
      models: REVIEWERS.map(item => item.model),
      roundContext: { round: 1 }
    };
    stage.request = sanitizeForReport(requestBody);
    const stageStarted = Date.now();
    try {
      const response = await requestJson("POST", stage.endpoint, requestBody);
      stage.durationMs = response.durationMs;
      stage.httpStatus = response.status;
      stage.requestBytes = response.requestBytes;
      stage.responseBytes = response.responseBytes;
      stage.response = sanitizeForReport(response.data);
      const reviewSession = response.data.reviewSession;
      stage.actual = reviewFacts(reviewSession);

      if (expected.review.success === false) {
        stage.status = "FAIL";
        stage.assertions.push("Expected AI Review to fail, but /api/review/session succeeded.");
        result.stopReason = "AI Review expectation mismatch.";
        result.durationMs = Date.now() - started;
        return result;
      }

      const assertion = assertReview(reviewSession, expected.review);
      stage.assertions = assertion.errors;
      stage.actual = assertion.facts;
      if (assertion.errors.length) {
        stage.status = "FAIL";
        result.stopReason = `AI Review assertion failed: ${assertion.errors.join("; ")}`;
        result.durationMs = Date.now() - started;
        return result;
      }

      stage.status = "PASS";
      result.overall = "PASS";
      result.stopReason = null;
    } catch (error) {
      stage.durationMs = error.durationMs ?? (Date.now() - stageStarted);
      stage.httpStatus = error.status ?? null;
      stage.requestBytes = error.requestBytes ?? byteLength(requestBody);
      stage.responseBytes = error.responseBytes ?? byteLength(error.body);
      stage.error = errorDetails(error);
      stage.response = sanitizeForReport(error.body || null);
      stage.actual = {
        success: false,
        errorCode: error.body?.code || error.code || null,
        httpStatus: error.status ?? null,
        message: error.message
      };

      if (expectedFailureMatches(error, expected.review)) {
        stage.status = "PASS_EXPECTED_FAILURE";
        result.overall = "PASS";
        result.stopReason = "AI Review failed as expected.";
      } else {
        stage.status = "FAIL";
        stage.assertions.push(`Unexpected AI Review failure: ${error.message}`);
        result.stopReason = "AI Review failed unexpectedly.";
      }
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}

function expectedText(stage) {
  const e = stage.expected || {};
  if (e.run === false) return `SKIP: ${e.reason || "not expected to run"}`;
  const parts = [`success=${e.success !== false}`];
  if (e.errorCode) parts.push(`errorCode=${e.errorCode}`);
  if (e.capabilities) parts.push(`capabilities=${e.capabilities.join("+")}`);
  if (e.semanticOperations !== undefined) parts.push(`semanticOps=${e.semanticOperations}`);
  if (e.executableActions !== undefined) parts.push(`actions=${e.executableActions}`);
  if (e.riskLevel) parts.push(`risk=${e.riskLevel}`);
  if (e.riskIn) parts.push(`risk∈[${e.riskIn.join("|")}]`);
  if (e.simulationSuccess !== undefined) parts.push(`simulation=${e.simulationSuccess}`);
  if (e.verdict) parts.push(`verdict=${e.verdict}`);
  if (e.verdictIn) parts.push(`verdict∈[${e.verdictIn.join("|")}]`);
  if (e.agreement) parts.push(`agreement=${e.agreement}`);
  if (e.reviewerCount) parts.push(`reviewers=${e.reviewerCount}`);
  return parts.join("; ");
}

function actualText(stage) {
  const a = stage.actual || {};
  if (stage.status === "SKIPPED") return stage.skipReason || "SKIPPED";
  const parts = [`status=${stage.status}`];
  if (a.errorCode) parts.push(`errorCode=${a.errorCode}`);
  if (a.message) parts.push(`message=${truncate(a.message, 180)}`);
  if (a.fingerprint) parts.push(`fingerprint=${a.fingerprint}`);
  if (a.semanticCapabilities) parts.push(`capabilities=${a.semanticCapabilities.join("+")}`);
  if (a.semanticOperations !== undefined) parts.push(`semanticOps=${a.semanticOperations}`);
  if (a.executableActions !== undefined) parts.push(`actions=${a.executableActions}`);
  if (a.risk) parts.push(`risk=${a.risk}`);
  if (a.riskScore !== null && a.riskScore !== undefined) parts.push(`score=${a.riskScore}`);
  if (a.simulationSuccess !== undefined) parts.push(`simulation=${a.simulationSuccess}`);
  if (a.findingCount !== undefined) parts.push(`findings=${a.findingCount}`);
  if (a.verdict) parts.push(`verdict=${a.verdict}`);
  if (a.agreement) parts.push(`agreement=${a.agreement}`);
  if (a.reviewerCount !== undefined) parts.push(`reviewers=${a.reviewerCount}`);
  return parts.join("; ");
}

function reviewerErrorDetails(stage) {
  const problems = stage.actual?.reviewerErrors || [];
  return problems.map(item => {
    const label = `${item.model || "unknown-model"}/${item.profile || "unknown-role"}`;
    const message = String(item.error || "No provider error details available").replace(/\s+/g, " ");
    return `${label}: ${truncate(message, 700)}`;
  });
}

function stageErrorText(stage) {
  const messages = [];
  if (Array.isArray(stage.assertions) && stage.assertions.length) messages.push(...stage.assertions);
  if (stage.error?.message) messages.push(stage.error.message);
  messages.push(...reviewerErrorDetails(stage));
  if (stage.error?.code) messages.push(`code=${stage.error.code}`);
  if (stage.error?.httpStatus) messages.push(`HTTP ${stage.error.httpStatus}`);
  return messages.join(" | ");
}

function writeCsv(report, basePath) {
  const file = `${basePath}.csv`;
  const headers = [
    "Case ID", "Description", "Enabled", "Test Input",
    "Compile Expected", "Compile Status", "Compile Actual", "Compile Duration (ms)", "Compile HTTP", "Compile Error",
    "Analyze Expected", "Analyze Status", "Analyze Actual", "Analyze Duration (ms)", "Analyze HTTP", "Analyze Error",
    "Review Expected", "Review Status", "Review Actual", "Review Duration (ms)", "Review HTTP", "Review Error",
    "Proposal Fingerprint", "Capabilities", "Executable Actions", "Risk", "Simulation Successful", "Review Verdict", "Agreement",
    "Overall", "Total Duration (ms)", "Stop Reason"
  ];
  const lines = [headers.map(csv).join(",")];
  for (const item of report.cases) {
    const c = item.stages.compile;
    const a = item.stages.analyze;
    const r = item.stages.review;
    lines.push([
      item.caseId, item.description, item.enabled, item.input,
      expectedText(c), c.status, actualText(c), c.durationMs, c.httpStatus ?? "", stageErrorText(c),
      expectedText(a), a.status, actualText(a), a.durationMs, a.httpStatus ?? "", stageErrorText(a),
      expectedText(r), r.status, actualText(r), r.durationMs, r.httpStatus ?? "", stageErrorText(r),
      item.proposalFingerprint || c.actual?.fingerprint || "",
      (c.actual?.semanticCapabilities || []).join("+"),
      c.actual?.executableActions ?? "",
      a.actual?.risk || "",
      a.actual?.simulationSuccess ?? "",
      r.actual?.verdict || "",
      r.actual?.agreement || "",
      item.overall,
      item.durationMs,
      item.stopReason || ""
    ].map(csv).join(","));
  }
  fs.writeFileSync(file, `\ufeff${lines.join("\n")}\n`, "utf8");
  return file;
}

function writeJson(report, basePath) {
  const file = `${basePath}.json`;
  fs.writeFileSync(file, JSON.stringify(sanitizeForReport(report), null, 2) + "\n", "utf8");
  return file;
}

function statusClass(status) {
  if (String(status).startsWith("PASS")) return "pass";
  if (status === "FAIL") return "fail";
  return "skip";
}

function jsonDetails(title, value, open = false) {
  if (value === null || value === undefined) return "";
  return `<details${open ? " open" : ""}><summary>${htmlEscape(title)}</summary><pre>${htmlEscape(pretty(value))}</pre></details>`;
}

function stageDetails(stage) {
  return `
    <section class="stage-card">
      <div class="stage-head">
        <h4>${htmlEscape(stage.name)}</h4>
        <span class="badge ${statusClass(stage.status)}">${htmlEscape(stage.status)}</span>
      </div>
      <div class="kv-grid">
        <div><b>Endpoint</b><span>${htmlEscape(stage.endpoint)}</span></div>
        <div><b>Duration</b><span>${htmlEscape(stage.durationMs)} ms</span></div>
        <div><b>HTTP</b><span>${htmlEscape(stage.httpStatus ?? "—")}</span></div>
        <div><b>Request / response bytes</b><span>${htmlEscape(stage.requestBytes ?? "—")} / ${htmlEscape(stage.responseBytes ?? "—")}</span></div>
      </div>
      <div class="compare-grid">
        <div><h5>Expected</h5><pre>${htmlEscape(pretty(stage.expected))}</pre></div>
        <div><h5>Actual</h5><pre>${htmlEscape(pretty(stage.actual))}</pre></div>
      </div>
      ${stage.assertions?.length ? `<div class="error-box"><b>Assertion failures</b><ul>${stage.assertions.map(item => `<li>${htmlEscape(item)}</li>`).join("")}</ul></div>` : ""}
      ${stage.error ? `<div class="error-box"><b>Error diagnostics</b><pre>${htmlEscape(pretty(stage.error))}</pre></div>` : ""}
      ${stage.skipReason ? `<div class="skip-box"><b>Skip reason:</b> ${htmlEscape(stage.skipReason)}</div>` : ""}
      ${jsonDetails("Exact request payload", stage.request)}
      ${jsonDetails("Exact API response", stage.response)}
    </section>`;
}

function writeHtml(report, basePath) {
  const file = `${basePath}.html`;
  const pass = report.summary.pass;
  const fail = report.summary.fail;
  const skipped = report.summary.skipped;
  const rows = report.cases.map(item => {
    const c = item.stages.compile;
    const a = item.stages.analyze;
    const r = item.stages.review;
    return `<tr class="${item.overall === "FAIL" ? "row-fail" : ""}">
      <td><a href="#${htmlEscape(item.caseId)}">${htmlEscape(item.caseId)}</a></td>
      <td>${htmlEscape(item.description)}</td>
      <td><div class="expect">${htmlEscape(expectedText(c))}</div><div class="actual ${statusClass(c.status)}">${htmlEscape(actualText(c))}</div></td>
      <td><div class="expect">${htmlEscape(expectedText(a))}</div><div class="actual ${statusClass(a.status)}">${htmlEscape(actualText(a))}</div></td>
      <td><div class="expect">${htmlEscape(expectedText(r))}</div><div class="actual ${statusClass(r.status)}">${htmlEscape(actualText(r))}</div></td>
      <td><span class="badge ${statusClass(item.overall)}">${htmlEscape(item.overall)}</span></td>
      <td>${htmlEscape(item.durationMs)} ms</td>
      <td>${htmlEscape(item.stopReason || "")}</td>
    </tr>`;
  }).join("\n");

  const detailBlocks = report.cases.map(item => `
    <article class="case ${item.overall === "FAIL" ? "case-fail" : ""}" id="${htmlEscape(item.caseId)}">
      <div class="case-title">
        <div><h3>${htmlEscape(item.caseId)}</h3><p>${htmlEscape(item.description)}</p></div>
        <span class="badge ${statusClass(item.overall)}">${htmlEscape(item.overall)}</span>
      </div>
      <div class="input-box"><b>Test input</b><pre>${htmlEscape(item.input)}</pre></div>
      <div class="kv-grid">
        <div><b>Proposal fingerprint</b><span>${htmlEscape(item.proposalFingerprint || "—")}</span></div>
        <div><b>Total duration</b><span>${htmlEscape(item.durationMs)} ms</span></div>
        <div><b>Stop reason</b><span>${htmlEscape(item.stopReason || "—")}</span></div>
        <div><b>Enabled</b><span>${htmlEscape(item.enabled)}</span></div>
      </div>
      ${stageDetails(item.stages.compile)}
      ${stageDetails(item.stages.analyze)}
      ${stageDetails(item.stages.review)}
      ${jsonDetails("Original case expectations", item.sourceExpected)}
    </article>`).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>YanFu AI Pipeline Diagnostic Report ${htmlEscape(report.metadata.runId)}</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--card:#0d1c31;--line:#28415f;--text:#eaf2ff;--muted:#9fb4cf;--pass:#29d391;--fail:#ff6b6b;--skip:#f4c95d;--blue:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif}main{max-width:1800px;margin:auto;padding:28px}h1,h2,h3,h4,h5{margin:.2em 0}.muted{color:var(--muted)}.summary{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.metric,.case,.stage-card,.preflight{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.metric b{font-size:24px;display:block}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:1500px;background:var(--card)}th,td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{position:sticky;top:0;background:#10243f}.expect{color:var(--muted);font-size:12px;margin-bottom:6px}.actual{font-weight:600}.pass{color:var(--pass)}.fail{color:var(--fail)}.skip{color:var(--skip)}.badge{display:inline-block;padding:3px 8px;border:1px solid currentColor;border-radius:999px;font-weight:700}.case{margin:24px 0}.case-title,.stage-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.input-box{margin:12px 0}.stage-card{margin:14px 0;background:#0a1729}.kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:10px 0}.kv-grid>div{background:#091425;padding:9px;border-radius:8px}.kv-grid b{display:block;color:var(--muted);font-size:12px}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.compare-grid>div{min-width:0}pre{white-space:pre-wrap;word-break:break-word;background:#06101d;border:1px solid #203a58;border-radius:8px;padding:10px;max-height:480px;overflow:auto}.row-fail{background:rgba(255,107,107,.14)}.row-fail td:first-child{border-left:4px solid var(--fail)}.case-fail{border-color:var(--fail);box-shadow:0 0 0 1px rgba(255,107,107,.35)}.error-box{border-left:4px solid var(--fail);background:#2a1119;padding:10px;margin:10px 0}.skip-box{border-left:4px solid var(--skip);background:#2b2510;padding:10px;margin:10px 0}details{margin:8px 0}summary{cursor:pointer;color:var(--blue)}a{color:var(--blue)}@media(max-width:800px){main{padding:12px}.compare-grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>YanFu AI Pipeline Diagnostic Report</h1>
<p class="muted">Run ${htmlEscape(report.metadata.runId)} · schema ${htmlEscape(report.metadata.reportSchemaVersion)} · YanFu ${htmlEscape(report.metadata.yanfuVersion)}</p>
<div class="summary">
  <div class="metric"><b>${pass}</b>PASS</div>
  <div class="metric"><b>${fail}</b>FAIL</div>
  <div class="metric"><b>${skipped}</b>SKIPPED</div>
  <div class="metric"><b>${report.summary.total}</b>TOTAL</div>
  <div class="metric"><b>${htmlEscape(report.metadata.durationMs)}</b>ms total</div>
</div>
<section class="preflight">
<h2>Run context & preflight</h2>
<div class="kv-grid">
  <div><b>API base</b><span>${htmlEscape(report.metadata.apiBase)}</span></div>
  <div><b>Case file SHA-256</b><span>${htmlEscape(report.metadata.caseFileSha256)}</span></div>
  <div><b>Compile / Analyze model</b><span>${htmlEscape(COMPILE_MODEL)}</span></div>
  <div><b>Node</b><span>${htmlEscape(report.metadata.environment.node)}</span></div>
</div>
${jsonDetails("Fixed reviewer profile", report.metadata.reviewers, true)}
${jsonDetails("Preflight diagnostics", report.preflight, true)}
</section>
<h2>Result table</h2>
<div class="table-wrap"><table><thead><tr><th>Case</th><th>Description</th><th>Compilation: Expected / Actual</th><th>Analyzation: Expected / Actual</th><th>AI Review: Expected / Actual</th><th>Overall</th><th>Duration</th><th>Stop / failure reason</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Per-case diagnostics</h2>
${detailBlocks}
</main></body></html>`;
  fs.writeFileSync(file, html, "utf8");
  return file;
}

function printConfiguration() {
  console.log("\n===== YanFu AI Pipeline Auto Test v1.0 =====");
  console.log("API:", API_BASE);
  console.log("Compile model:", COMPILE_MODEL);
  console.log("Analyze model:", ANALYZE_MODEL);
  console.log("Reviewers:");
  REVIEWERS.forEach((item, index) => console.log(`  ${index + 1}. ${item.model} / ${item.profileId}`));
  console.log("Input:", path.relative(ROOT, CASE_FILE));
  if (TEST_TAG) console.log("Case tag filter:", TEST_TAG);
  console.log("Reports: HTML diagnostic + JSON diagnostic + CSV summary");
  console.log("================================================\n");
}

async function main() {
  const identity = runIdentity();
  const cases = loadCases();
  const runStartMs = Date.now();
  printConfiguration();

  const preflightResult = await preflight();
  console.log(`Preflight ${preflightResult.status}`);

  const results = [];
  if (preflightResult.status !== "PASS") {
    for (const testCase of cases) {
      const expected = testCase.normalizedExpected;
      const result = {
        caseId: testCase.id,
        description: testCase.description,
        enabled: testCase.enabled,
        input: testCase.text,
        sourceExpected: sanitizeForReport(testCase.expected),
        normalizedExpected: sanitizeForReport(expected),
        overall: testCase.enabled ? "FAIL" : "SKIPPED",
        stopReason: testCase.enabled ? "Preflight failed; no AI pipeline stage was executed." : "Test case disabled in input file.",
        durationMs: 0,
        proposalFingerprint: null,
        stages: {
          compile: newStage("Compilation", "/api/generate", expected.compile, { model: COMPILE_MODEL }),
          analyze: newStage("Analyzation", "/api/analyze", expected.analyze, { model: ANALYZE_MODEL }),
          review: newStage("AI Review", "/api/review/session", expected.review, { reviewers: REVIEWERS })
        }
      };
      markSkipped(result.stages.compile, result.stopReason);
      markSkipped(result.stages.analyze, result.stopReason);
      markSkipped(result.stages.review, result.stopReason);
      results.push(result);
    }
  } else {
    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index];
      console.log(`\n[${index + 1}/${cases.length}] ${testCase.id}`);
      const result = await runCase(testCase);
      results.push(result);
      console.log(`  Compile : ${result.stages.compile.status} | ${truncate(actualText(result.stages.compile), 140)}`);
      console.log(`  Analyze : ${result.stages.analyze.status} | ${truncate(actualText(result.stages.analyze), 140)}`);
      console.log(`  Review  : ${result.stages.review.status} | ${truncate(actualText(result.stages.review), 140)}`);
      console.log(`  Overall : ${result.overall}${result.stopReason ? ` | ${truncate(result.stopReason, 160)}` : ""}`);
    }
  }

  const endedAt = new Date().toISOString();
  const report = {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    metadata: {
      reportSchemaVersion: REPORT_SCHEMA_VERSION,
      runId: identity.runId,
      startedAt: identity.startedAt,
      endedAt,
      durationMs: Date.now() - runStartMs,
      yanfuVersion: APP_CONFIG.version,
      apiBase: API_BASE,
      caseFile: path.relative(ROOT, CASE_FILE),
      caseFileSha256: sha256File(CASE_FILE),
      caseTag: TEST_TAG || null,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      compileModel: COMPILE_MODEL,
      analyzeModel: ANALYZE_MODEL,
      reviewers: REVIEWERS,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      }
    },
    preflight: preflightResult,
    summary: {
      total: results.length,
      enabled: results.filter(item => item.enabled).length,
      pass: results.filter(item => item.overall === "PASS").length,
      fail: results.filter(item => item.overall === "FAIL").length,
      skipped: results.filter(item => item.overall === "SKIPPED").length,
      compileFailures: results.filter(item => item.stages.compile.status === "FAIL").length,
      analyzeFailures: results.filter(item => item.stages.analyze.status === "FAIL").length,
      reviewFailures: results.filter(item => item.stages.review.status === "FAIL").length
    },
    cases: results
  };

  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const basePath = path.join(RESULT_DIR, identity.baseName);
  const htmlFile = writeHtml(report, basePath);
  const jsonFile = writeJson(report, basePath);
  const csvFile = writeCsv(report, basePath);

  console.log("\n===== Result Table =====");
  console.table(results.map(item => ({
    Case: item.caseId,
    "Compile E/A": `${truncate(expectedText(item.stages.compile), 32)} / ${item.stages.compile.status}`,
    "Analyze E/A": `${truncate(expectedText(item.stages.analyze), 32)} / ${item.stages.analyze.status}`,
    "Review E/A": `${truncate(expectedText(item.stages.review), 32)} / ${item.stages.review.status}`,
    Overall: item.overall
  })));
  console.log("\nPrimary HTML report:", htmlFile);
  console.log("Diagnostic JSON    :", jsonFile);
  console.log("CSV summary        :", csvFile);

  if (report.summary.fail) {
    console.error(`\n${report.summary.fail} test case(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: ${report.summary.pass} case(s), SKIPPED: ${report.summary.skipped} case(s).`);
  }
}

main().catch(error => {
  console.error("Fatal test-runner error:", error.stack || error.message || error);
  process.exitCode = 1;
});
