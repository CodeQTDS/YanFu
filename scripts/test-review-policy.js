"use strict";
// Dependency-free policy regression: verifies role-specific criteria, permissive
// independent verdicts, fail-closed deterministic gating, and consensus.
// All AI outputs are MOCKED. This script never calls a provider or chain.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const reviewers = read("config/reviewers.config.json");
const policy = read("config/review-policy.json");
const templates = read("config/prompt-templates.json");
const files = ["backend/review/reviewerEngine.js", "backend/review/consensus.js"];
const moduleFromFile = (relative, requireMocks) => {
  const file = path.join(root, relative);
  const mod = {exports:{}};
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: key => {
      if (!Object.prototype.hasOwnProperty.call(requireMocks,key)) throw Error(`Unmocked require: ${key}`);
      return requireMocks[key];
    }, module:mod, exports:mod.exports, console, process, Date, Buffer, setTimeout, clearTimeout
  }, {filename:file});
  return mod.exports;
};

const expectedByRole = {
  "general-governance":"NEEDS_CHANGES",
  "treasury-governance":"APPROVE",
  "intent-fidelity":"APPROVE",
  "security-execution":"APPROVE",
  "governance-mechanism":"REJECT"
};
const capturedPrompts=[];
const fakeGenerate = async ({prompt,modelId}) => {
  capturedPrompts.push(prompt);
  const role = reviewers.profiles.find(p => prompt.includes(`PROFILE: ${p.label}`));
  assert(role, "role was not sent to model");
  const verdict=expectedByRole[role.id];
  return {
    text:JSON.stringify({
      verdict,
      confidence:0.92,
      workSummary:`Mocked independent review by ${role.label}`,
      roleAssessment:{
        focus:role.primaryMission,
        evidenceChecked:["encoded Governor actions", "simulation", "source request"],
        conclusion:`Role-specific test verdict: ${verdict}`,
        uncertainty:null,
        decisionBasis: role.id==="intent-fidelity" ? "INTENT_FIDELITY":"GOVERNANCE_POLICY",
        residualGovernanceRisk: role.id==="governance-mechanism" ? "HIGH":"LOW",
        governanceRiskReason:"Mock evidence supplied for verdict preservation testing"
      },
      findings: verdict==="APPROVE" ? [] : [{category:"policy-risk",severity:"HIGH",message:"Test-only concern",suggestion:"Reconsider governance safeguards"}],
      recommendedAdjustments:verdict==="APPROVE" ? [] : ["Reconsider governance safeguards"],
      revisedNaturalLanguage:null
    }), modelId
  };
};
const engine=moduleFromFile(files[0],{
 "../ai/modelClient":{generate:fakeGenerate},
 "../utils/json":{extractJson:JSON.parse},
 "../config/configLoader":{
   loadReviewPolicy:()=>policy,
   loadReviewersConfig:()=>reviewers,
   loadPromptTemplates:()=>templates
 }
});
const consensus=moduleFromFile(files[1],{"../config/configLoader":{loadReviewersConfig:()=>reviewers}});
const evidence={
  proposalFingerprint:"abc123",historicalPlan:false,
  executableActions:[{decoded:true,functionName:"setVotingDelay",arguments:{newVotingDelay:"0"}},{decoded:true,functionName:"setVotingPeriod",arguments:{newVotingPeriod:"1"}},{decoded:true,functionName:"updateQuorumNumerator",arguments:{newQuorumNumerator:"1"}}],
  deterministic:{passed:true,findings:[],sourceIntent:{passed:true}},
  simulation:{allSuccessful:true,results:[{index:0,success:true},{index:1,success:true},{index:2,success:true}]},
  chainContext:{chainId:31337,expectedChainId:31337,treasury:{},governance:{},contracts:{}},
  actionAnalysis:{findings:[]}
};
const proposal={
  sourceText:"Set voting delay to 0 blocks, period to 1 block, quorum numerator to 1.",description:"Governance acceleration",fingerprint:"abc123",
  actions:[], plan:{status:"ready",operations:[]}, targets:[],values:[],calldatas:[]
};
(async()=>{
  assert.strictEqual(policy.version,3);
  assert.strictEqual(reviewers.limits.maxReviewers,5);
  assert.strictEqual(reviewers.limits.requireUniqueModelRolePairs,true);
  assert.strictEqual(reviewers.profiles.length,5);
  assert(templates.review.rules.some(x=>x.includes("NOT sufficient grounds")));
  const decisions=[];
  for (let i=0;i<reviewers.profiles.length;i++) {
    const profile=reviewers.profiles[i];
    assert(profile.decisionCriteria.length>=2, `missing decision criteria for ${profile.id}`);
    const prompt=engine.buildReviewPrompt({proposal,analysis:null,evidence,model:"modelscope:qwen3.5-35b-a3b",profile,reviewerIndex:i});
    assert(prompt.includes("ROLE-SPECIFIC VERDICT CRITERIA"));
    for (const criterion of profile.decisionCriteria) assert(prompt.includes(criterion));
    assert(prompt.includes("NOT sufficient to mandate APPROVE"));
    const result=await engine.runSingleReviewer({proposal,analysis:null,model:"modelscope:qwen3.5-35b-a3b",profileId:profile.id,reviewerIndex:i,evidence});
    assert.strictEqual(result.verdict,expectedByRole[profile.id],`verdict incorrectly coerced for ${profile.id}`);
    assert.strictEqual(result.roleAssessment.decisionBasis,profile.id==="intent-fidelity" ? "INTENT_FIDELITY":"GOVERNANCE_POLICY");
    assert(result.roleAssessment.governanceRiskReason);
    decisions.push(result);
  }
  assert.strictEqual(new Set(capturedPrompts).size,5);
  const summary=consensus.aggregateReviewSession({reviews:decisions,evidence});
  assert.strictEqual(summary.verdict,"REJECT","reject-dominates consensus must hold");
  assert.strictEqual(summary.agreement,"MAJORITY");
  const forced=await engine.runSingleReviewer({proposal,analysis:null,model:"modelscope:qwen3.5-35b-a3b",profileId:"intent-fidelity",reviewerIndex:2,evidence:{...evidence,deterministic:{passed:false,findings:[{severity:"HIGH",message:"Deterministic failure"}]}}});
  assert.strictEqual(forced.verdict,"NEEDS_CHANGES","deterministic failure must still prevent approval");
  const ui=fs.readFileSync(path.join(root,"frontend/assets/js/review.js"),"utf8");
  assert(ui.includes("Residual governance risk")&&ui.includes("Decision basis")&&ui.includes("Governance risk reasoning"));
  console.log("PASS review policy autonomy: independent role decisions preserved, five distinct decision criteria, deterministic fail-close, reject-dominates consensus, and UI risk rationale");
})().catch(err=>{console.error("FAIL review policy autonomy",err);process.exitCode=1});
