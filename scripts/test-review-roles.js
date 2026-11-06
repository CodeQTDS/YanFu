"use strict";
// Dependency-free, offline review-role regression. No real AI, RPC or wallet calls.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/reviewers.config.json"), "utf8"));

function loadModule(relative, mocks) {
  const filename = path.join(root, relative);
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: mod, exports: mod.exports, require: name => {
      if (!(name in mocks)) throw new Error(`${relative}: unexpected require ${name}`);
      return mocks[name];
    }, console, process, setTimeout, clearTimeout, Date, Buffer
  }, { filename });
  return mod.exports;
}

function big(value) { return { _isBigNumber: true, toString: () => String(value) }; }
const addr = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const originalAmounts = [10,20,30,40,50,60,70];
const editedAmounts = [20,20,30,40,50,60,70];
const recipients = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9"
];
const token = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const amountWei = x => big(BigInt(x)*10n**18n);
const registry = [{
  id:"treasury.batchTransferERC20", address:addr, abi:"function batchTransferERC20(address token,address[] recipients,uint256[] amounts)",
  signature:"batchTransferERC20(address,address[],uint256[])",functionName:"batchTransferERC20",pack:"Treasury Pack",
  inputs:[{name:"token",type:"address"},{name:"recipients",type:"address[]"},{name:"amounts",type:"uint256[]",semantic:"token-amount-list",decimals:18}]
}];
const ethers = { utils: {
  Interface: class {
    parseTransaction({data}) {
      if (data !== "0xeditedbatch") throw new Error("unknown calldata");
      return { signature:registry[0].signature, args:[token,recipients,editedAmounts.map(amountWei)] };
    }
  },
  formatUnits: n => (BigInt(n.toString())/10n**18n).toString(),
  formatEther: n => (BigInt(n.toString())/10n**18n).toString()
}};

(async () => {
  assert.strictEqual(cfg.limits.maxReviewers, 5);
  for(const p of cfg.profiles) {
    assert(p.primaryMission && p.roleQuestions.length >= 2 && p.evidencePriorities.length >= 2,p.id);
  }
  assert.strictEqual(new Set(cfg.profiles.map(x => x.primaryMission)).size, cfg.profiles.length);
  const executable = loadModule("backend/review/executableEvidence.js", {
    ethers: {ethers}, "../proposal/capabilityRegistry": {buildCapabilityRegistry:()=>registry}
  });
  const proposal = {
    sourceText: `Send 10 tokens to ${recipients[0]} and total 280 tokens.`,
    description:"Human-edited 290 token batch", fingerprint:"new-fingerprint",
    targets:[addr], values:["0"], calldatas:["0xeditedbatch"],
    plan:{status:"ready",operations:[{capabilityId:registry[0].id,arguments:{amounts:originalAmounts}}]},
    actions:[{capabilityId:registry[0].id,arguments:{amounts:originalAmounts}}],
    metadata:{editedBy:"HUMAN",humanGovernorOverride:true,semanticPlanStatus:"STALE_AFTER_FINAL_GOVERNOR_OVERRIDE",previousFingerprint:"old-fingerprint"}
  };
  const decoded = executable.decodeExecutableProposal(proposal,registry);
  assert.strictEqual(decoded[0].decoded,true);
  assert.strictEqual(decoded[0].arguments.amounts[0],"20");
  assert.strictEqual(decoded[0].arguments.amounts.reduce((a,b)=>a+Number(b),0),290);
  assert.strictEqual(executable.decodeExecutableProposal({...proposal,calldatas:["0xunknown"]},registry)[0].decoded,false);
  let checkedRawAmount = null;
  let stalePlanValidationRuns = 0;
  const ev = loadModule("backend/review/evidence.js", {
    "../proposal/capabilityRegistry":{buildCapabilityRegistry:()=>registry},
    "../proposal/sourceIntentGuard":{sourceIntentConsistencyReview:({proposal: input})=>{
      checkedRawAmount = input.actions?.[0]?.arguments?.amounts?.[0] ?? null;
      return {passed:true,findings:[]};
    }},
    "../proposal/validator":{
      validatePlan:()=>{stalePlanValidationRuns++;return {valid:true,errors:[]}},
      validateGovernorProposalShape:()=>({valid:true,errors:[]})
    },
    "../proposal/encoder":{buildGovernorProposal:()=>({})},
    "../proposal/integrity":{proposalFingerprint:()=>"new-fingerprint"},
    "../chain/context":{getChainContext:async()=>({})},
    "../chain/simulator":{simulateProposalCalls:async()=>({results:[],allSuccessful:true})},
    "../proposal/actionAnalyzer":{analyzeProposalActions:()=>({findings:[]})},
    "./executableEvidence":{decodeExecutableProposal:()=>decoded}
  });
  const deterministic=ev.deterministicReview({proposal,chainContext:{chainId:1,expectedChainId:1,contracts:{}},simulation:{results:[]},actionAnalysis:{findings:[]}});
  assert.strictEqual(deterministic.historicalPlan,true);
  assert.strictEqual(checkedRawAmount,"20");
  assert.strictEqual(stalePlanValidationRuns,0);
  const re = loadModule("backend/review/reviewerEngine.js",{
    "../ai/modelClient":{generate:async()=>({text:'{}'})},"../utils/json":{extractJson:JSON.parse},
    "../config/configLoader": {
      loadReviewPolicy:()=>({requiredChecks:["source-intent-fidelity"],verdicts:["APPROVE","NEEDS_CHANGES","REJECT"]}),
      loadReviewersConfig:()=>cfg,
      loadPromptTemplates:()=>({review:{system:"Review",rules:["Do not invent data."]}})
    }
  });
  const evidence={proposalFingerprint:"new-fingerprint",historicalPlan:true,executableActions:decoded,
    deterministic:{passed:true,findings:[],sourceIntent:{passed:true}},simulation:{allSuccessful:true,results:[]},
    chainContext:{treasury:{},governance:{},token:{}},actionAnalysis:{treasury:{configuredTokenOutflowBaseUnits:"290000000000000000000"}}
  };
  const packet=re.buildReviewEvidencePacket({proposal,analysis:null,evidence});
  assert.strictEqual(packet.proposal.semanticActionsAreHistorical,true);
  assert.strictEqual(packet.proposal.plan,null);
  assert.deepStrictEqual(Array.from(packet.proposal.actions),[]);
  assert.strictEqual(packet.proposal.encodedGovernor.actions[0].arguments.amounts[0],"20");
  const prompts=cfg.profiles.map(profile=>re.buildReviewPrompt({proposal,analysis:null,evidence,model:"modelscope:qwen3.5-35b-a3b",profile,reviewerIndex:0}));
  assert.strictEqual(new Set(prompts).size, cfg.profiles.length);
  for(let i=0;i<prompts.length;i++){
    assert(prompts[i].includes(cfg.profiles[i].primaryMission));
    assert(prompts[i].includes('ROLE ASSESSMENT RULES'));
    assert(prompts[i].includes('Shared') || prompts[i].includes('SHARED'));
  }
  const ui=fs.readFileSync(path.join(root,"frontend/assets/js/review.js"),"utf8");
  const html=fs.readFileSync(path.join(root,"frontend/pages/review.html"),"utf8");
  assert(ui.includes("roleAssessment.conclusion"));
  assert(ui.includes("renderCommonBlockers"));
  assert(html.includes('id="sharedReviewBlockers"'));
  console.log("PASS role specialization: 5 differentiated missions, authoritative decoded 290-token payload, stale metadata excluded, shared blockers once, role-specific report UI");
})().catch(e=>{console.error("FAIL role specialization",e);process.exitCode=1});
