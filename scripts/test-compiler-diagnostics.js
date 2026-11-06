"use strict";

const assert = require("assert");
const path = require("path");
const Module = require("module");
const { resolveConfiguredTokenSymbol } = require("../backend/proposal/tokenSymbolResolver");

const TOKEN = "0x1234567890123456789012345678901234567890";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CHAIN = { token: { symbol: "MTK" }, addresses: { token: TOKEN } };
const registry = ["treasury.transferERC20", "treasury.batchTransferERC20"].map(id => ({
  id,
  inputs: [{ name: "token", default: TOKEN }]
}));
const source = "Make exactly one atomic batch ERC20 transfer using MTK, seven recipients; send 10, 20, 30, 40, 50, 60, and 70 MTK (280 MTK total).";
let assertions = 0;
function ok(condition, message) { assert.ok(condition, message); assertions++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); assertions++; }
function makePlan(token, capabilityId = "treasury.batchTransferERC20") {
  return { status: "ready", operations: [{ capabilityId, arguments: {
    token,
    recipients: Array.from({length: 7}, (_, i) => `0x${String(i + 1).repeat(40)}`),
    amounts: ["10","20","30","40","50","60","70"]
  }}] };
}

// Reproduce the seven-payment smoke case and verify exact recipient/amount preservation.
for (let i = 0; i < 100; i++) {
  const before = i % 2 ? "mtk" : "MTK";
  const plan = makePlan(before, i % 3 === 0 ? "treasury.transferERC20" : "treasury.batchTransferERC20");
  const unchangedRecipients = JSON.stringify(plan.operations[0].arguments.recipients);
  const unchangedAmounts = JSON.stringify(plan.operations[0].arguments.amounts);
  eq(resolveConfiguredTokenSymbol({plan, chainContext: CHAIN, registry, sourceText: source}), 1, "exact symbol must resolve");
  eq(plan.operations[0].arguments.token, TOKEN, "address is the configured address");
  eq(JSON.stringify(plan.operations[0].arguments.recipients), unchangedRecipients, "recipients unchanged");
  eq(JSON.stringify(plan.operations[0].arguments.amounts), unchangedAmounts, "amounts unchanged");
}
for (const [token, request, cap, ctx, caps] of [
  ["USDC", source, "treasury.batchTransferERC20", CHAIN, registry],
  [OTHER, source, "treasury.batchTransferERC20", CHAIN, registry],
  ["MTK token", source, "treasury.batchTransferERC20", CHAIN, registry],
  ["MTK", "Send another token, no known ticker given", "treasury.batchTransferERC20", CHAIN, registry],
  ["MTK", source, "registered.pay", CHAIN, registry],
  ["MTK", source, "treasury.batchTransferETH", CHAIN, registry],
  ["MTK", source, "treasury.batchTransferERC20", { ...CHAIN, token: { symbol: "unavailable" }}, registry],
  ["MTK", source, "treasury.batchTransferERC20", { ...CHAIN, addresses: { token: OTHER } }, registry],
  ["MTK", source, "treasury.batchTransferERC20", CHAIN, registry.map(x => ({...x,inputs: [{name: "token",default:OTHER}]}))]
]) {
  const plan = makePlan(token, cap);
  eq(resolveConfiguredTokenSymbol({ plan, chainContext: ctx, registry: caps, sourceText: request }), 0, "unsafe guess must remain unrepaired");
  eq(plan.operations[0].arguments.token, token, "unknown/other token preserved for rejection");
}

// Exercise actual generateProposal with dependency injection, and ensure
// both the corrected plan and its original source-intent gate are validated.
async function main() {
  const realLoad = Module._load;
  const target = path.resolve(__dirname, "../backend/proposal/generator.js");
  let planToReturn = makePlan("MTK");
  let validatorSaw = null;
  let sourceGuardCalled = false;
  const mocks = {
    "../ai/modelClient": { generateJson: async () => ({ modelId:"modelscope:qwen3.5-35b-a3b", json: planToReturn }) },
    "../config/configLoader": { loadPromptTemplates: () => ({ generation: {system:"test",rules:[]} }) },
    "../chain/context": { getChainContext: async () => ({...CHAIN, chainId:31337,blockNumber:99}) },
    "./capabilityRegistry": { buildCapabilityRegistry: () => registry, plannerCapabilities: x => x },
    "./factExtractor": { extractFacts: () => ({}) },
    "./sourceIntentGuard": {
      validateSourceIntent: () => ({valid:true,errors:[]}),
      sourceIntentConsistencyReview: ({proposal}) => { sourceGuardCalled = true; return {passed:proposal.plan.operations[0].arguments.token===TOKEN,findings:[]}; }
    },
    "./validator": { validatePlan: ({plan}) => {validatorSaw = plan.operations[0].arguments.token; return {valid: validatorSaw===TOKEN, errors: validatorSaw===TOKEN?[]:["invalid token address"]};} },
    "./encoder": {buildGovernorProposal:({description,metadata})=>({ description, metadata,targets:[TOKEN],values:["0"],calldatas:["0x12345678"] })},
    "./integrity": { proposalFingerprint: () => "deterministic-fingerprint" }
  };
  Module._load = function(request, parent, isMain) {
    if (parent?.filename && path.resolve(parent.filename) === target && Object.prototype.hasOwnProperty.call(mocks,request)) return mocks[request];
    return realLoad.apply(this,arguments);
  };
  let generateProposal;
  try { ({generateProposal} = require(target)); } finally { Module._load = realLoad; }
  const proposal = await generateProposal({text: source, model:"modelscope:qwen3.5-35b-a3b"});
  eq(validatorSaw,TOKEN,"actual compiler validates the configured address after symbol resolution");
  ok(sourceGuardCalled,"actual compiler still invokes source intent validation");
  eq(proposal.plan.operations[0].arguments.token,TOKEN,"encoded proposal receives resolved token");
  eq(proposal.plan.operations[0].arguments.amounts.join(","),"10,20,30,40,50,60,70","seven amounts preserved");
  planToReturn=makePlan("USDC");
  sourceGuardCalled=false;
  await assert.rejects(() => generateProposal({text:source, model:"modelscope:qwen3.5-35b-a3b"}), error => {
    eq(error.code, "INVALID_GENERATED_PLAN", "invalid generated plan gets explicit error code");
    eq(error.plan.operations[0].arguments.token, "USDC", "raw invalid model token preserved for diagnosis");
    return /invalid token address/.test(error.message);
  });
  ok(!sourceGuardCalled,"unverified token never reaches source guard or encoder");
  // The CSV now prints the reviewer error detail instead of only the model ID.
  const fs = require("fs"), vm = require("vm");
  const runner = fs.readFileSync(path.join(__dirname, "run-yanfu-ai-pipeline-test.js"), "utf8");
  const chunk = runner.slice(runner.indexOf("function reviewerErrorDetails("), runner.indexOf("function writeCsv("));
  const sandbox = {exports:{},truncate:(value,max)=>String(value).slice(0,max)};
  vm.runInNewContext(chunk + "\nexports.get=stageErrorText;",sandbox);
  const reviewFailure = {actual:{reviewerErrors:[{model:"modelscope:deepseek-v4-pro-0813", profile:"intent-fidelity",error:"HTTP 429 rate limit"}]}, assertions:["1 reviewer failed"]};
  const rendered = sandbox.exports.get(reviewFailure);
  ok(rendered.includes("HTTP 429 rate limit"),"reviewer provider failure reason included in CSV");
  ok(rendered.includes("intent-fidelity"),"reviewer role included in CSV");
  ok(runner.includes("YANFU_TEST_REVIEWER_3"),"optional comparison reviewer is supported");
  console.log(`PASS v1.0 smoke compiler/reviewer diagnostics: ${assertions} checks, configured token normalized, seven payments preserved, unknown tokens rejected, reviewer errors observable`);
}
main().catch(error => {console.error("FAIL v1.0 smoke token safety:",error);process.exitCode=1;});

// Separate smoke runner report checks: detail must show provider error, not
// only the failing model ID. This is a diagnostic regression, not a review pass.
