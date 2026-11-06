"use strict";
// Regression for v1.0 false CRITICAL reencoding caused by comparing review
// provenance with a rebuilt Governor proposal that has no top-level sourceText.
// Uses production evidence.js and integrity.js with mocked validator and ABI
// encoder, no live EVM/node_modules/provider/wallet dependency.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {proposalFingerprint, governorExecutionFingerprint} = require("../backend/proposal/integrity");
const base = path.resolve(__dirname, "..");
const recipients = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9"
];
const amounts = ["10","20","30","40","50","60","70"];
const sourceText = `Make one batch ERC20 transfer from the Treasury. ${recipients.map((addr,i) => `Send ${amounts[i]} tokens to ${addr}`).join(", ")}. The total amount transferred must be exactly 280 tokens. Execute all seven payments through one batch ERC20 transfer operation.`;
const plan = {status:"ready", operations:[{capabilityId:"treasury.batchTransferERC20",arguments:{token:"0x5FbDB2315678afecb367f032d93F642f64180aa3",recipients,amounts}}]};
// Encoded bytes are stable test fixtures. Real ABI correctness is checked by
// the original encoder/EVM test suites, not by this mock regression.
function encodePlan({plan,description,metadata}) {
  const bytes = "0x"+Buffer.from(JSON.stringify(plan.operations)).toString("hex");
  return {targets:["0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"],values:["0"],calldatas:[bytes],description,metadata};
}
const description = "Batch 280 MTK to seven recipients";
const original = {...encodePlan({plan,description,metadata:{sourceText,chainId:31337}}),plan,sourceText,chainContext:{chainId:31337}};
const rebuilt = encodePlan({plan,description,metadata:original.metadata});
assert.notStrictEqual(proposalFingerprint(original),proposalFingerprint(rebuilt),"Reproduce v1.0 erroneous provenance mismatch");
assert.strictEqual(governorExecutionFingerprint(original),governorExecutionFingerprint(rebuilt),"Rebuilding same calldata must match");
assert.notStrictEqual(proposalFingerprint(original),proposalFingerprint({...original,sourceText:sourceText.replace("280", "290")}),"Source tampering must invalidate review provenance");
assert.notStrictEqual(proposalFingerprint(original),proposalFingerprint({...original,metadata:{...original.metadata,chainId:1}}),"Chain tampering must invalidate review provenance");
assert.strictEqual(governorExecutionFingerprint(original),governorExecutionFingerprint({...original,sourceText:"different request",metadata:{sourceText:"different",chainId:1}}),"Execution fingerprint must exclude provenance");
for(const key of ["targets","values","calldatas"]){
  const tampered = {...original,[key]:original[key].slice()};
  tampered[key][0] = key==="values"?"1":key==="calldatas"?"0xdeadbeef":"0x"+"3".repeat(40);
  assert.notStrictEqual(governorExecutionFingerprint(tampered),governorExecutionFingerprint(rebuilt),`Changed ${key} must be blocked`);
}
assert.notStrictEqual(governorExecutionFingerprint({...original,description:"altered"}),governorExecutionFingerprint(rebuilt));
const integrity = require("../backend/proposal/integrity");
const registry = [{}];
const mocks = {
  "../proposal/capabilityRegistry":{buildCapabilityRegistry:()=>registry},
  "../proposal/sourceIntentGuard":{sourceIntentConsistencyReview:()=>({passed:true,findings:[]})},
  "../proposal/validator":{validatePlan:()=>({valid:true,errors:[]}), validateGovernorProposalShape:()=>({valid:true,errors:[]})},
  "../proposal/encoder":{buildGovernorProposal:({plan,description,metadata})=>encodePlan({plan,description,metadata})},
  "../proposal/integrity":integrity,
  "../chain/context":{getChainContext:async()=>({})},
  "../chain/simulator":{simulateProposalCalls:async()=>({results:[],allSuccessful:true})},
  "../proposal/actionAnalyzer":{analyzeProposalActions:()=>({findings:[]})},
  "./executableEvidence":{decodeExecutableProposal:()=>[]}
};
function loadEvidence() {
  const filename=path.join(base,"backend/review/evidence.js");
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,"utf8"), {
    module:mod,exports:mod.exports,
    require:name=>{if(!(name in mocks))throw Error("Unexpected require: "+name);return mocks[name]},
    console,Buffer,process,Date, setTimeout
  },{filename});
  return mod.exports;
}
const evidence=loadEvidence();
const context={chainId:31337,expectedChainId:31337,contracts:{}};
const simulation={results:[],allSuccessful:true};
const findings = input=>evidence.deterministicReview({proposal:input,chainContext:context,simulation,actionAnalysis:{findings:[]}}).findings;
let cases=0;
for(let i=0;i<100;i++){
  const src=sourceText+` Test reference ${i}`;
  const fresh={...original,sourceText:src,metadata:{...original.metadata,sourceText:src},fingerprint:"not-trusted-here"};
  const validFindings=findings(fresh);
  assert(!validFindings.some(f=>f.category==="deterministic-reencoding"),`Unchanged execution must not trigger CRITICAL: case ${i}`);
  cases++;
  for(const kind of ["calldatas","values","targets"]){
    const altered={...fresh,[kind]:fresh[kind].slice()};
    altered[kind][0]=kind==="values"?"1":kind==="calldatas"?"0xdeadbeef":"0x"+"3".repeat(40);
    assert(findings(altered).some(f=>f.category==="deterministic-reencoding"),`Executable ${kind} modification must trigger CRITICAL: ${i}`);
    cases++;
  }
  const human={...fresh,metadata:{...fresh.metadata,editedBy:"HUMAN",humanGovernorOverride:true,semanticPlanStatus:"STALE_AFTER_FINAL_GOVERNOR_OVERRIDE"},calldatas:["0xdeadbeef"]};
  assert(!findings(human).some(f=>f.category==="deterministic-reencoding"),"Explicit human calldata override must remain outside stale-plan reencoding validation");
  cases++;
}
console.log(`PASS v1.0 deterministic reencoding: ${cases} reviews, source/chain context binding preserved, executable mismatch still blocked, Human Authority supported`);
