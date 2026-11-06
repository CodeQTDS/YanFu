"use strict";
// Dependency-free regression assertions for the v1.0 human authority UI gates.
// These test the actual browser JS functions in a controlled VM; not EVM integration.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend/pages/editor.html"), "utf8");
const js = fs.readFileSync(path.join(root, "frontend/assets/js/editor.js"), "utf8");
for (const id of [
  "encodedPreview", "humanRewriteSwitch", "humanRewritePanel", "humanRewriteGuided",
  "humanRewriteExact", "guidedEditorPanel", "finalGovernorOverridePanel",
  "rebuildBtn", "applyGovernorOverrideBtn", "humanRewriteConfirmPanel",
  "humanRewriteConfirmCheckbox", "humanConfirmCheckbox", "humanEditRiskCheckbox", "submitBtn"
]) {
  assert.strictEqual((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} must occur exactly once`);
}
assert.match(html, /id="humanRewritePanel" hidden/);
assert.match(html, /id="finalGovernorOverridePanel" hidden/);
assert.match(html, /id="humanRewriteConfirmPanel"[^>]*hidden/);
assert.match(html, /name="humanRewriteMethod"[^>]*value="guided"/);
assert.match(html, /name="humanRewriteMethod"[^>]*value="exact"/);
assert.ok(!html.includes("guidedModeBtn") && !html.includes("editProposalDetails"), "remove legacy confusing controls");

const elements = {};
const get = id => elements[id] ||= {
  id, checked:false, disabled:false, hidden:false, value:"", classList:{toggle(){}},
  setAttribute(){}, getAttribute(){return null;}
};
const document = { getElementById:get, addEventListener(){} };
const state = {proposal:null, validation:null, reviewSession:null, humanEditContext:null, humanConfirmation:null};
const sandbox = {
  document, console, Date, Map, JSON, Set,
  confirm:() => true,
  DAO_UI: {setStatus(){}, severityBadge:()=>"<span>badge</span>"},
  DAO_STATE:{load:()=>state, save:patch=>{Object.assign(state,patch);return state;}},
  DAO_NAV:{renderWorkflow(){}},
};
vm.createContext(sandbox);
vm.runInContext(js, sandbox, {filename:"frontend/assets/js/editor.js"});
vm.runInContext(`appConfig = {workflow:{requireReviewBeforeSubmit:true,requireApprovedReviewForSubmit:true,
  allowHumanReviewOverride:true, humanEditOverride:{enabled:true,requirePreviousReviewSession:true,
  requireFreshValidation:true,requireRiskAcknowledgement:true},reviewResultOverride:{enabled:true,requireAcknowledgement:true}}}`,sandbox);
const evaluate = command => vm.runInContext(command,sandbox);
function seed({edited=false,reviewed=false,validated=true}={}) {
  state.proposal = {fingerprint:"fingerprint-new",metadata:edited?{editedBy:"HUMAN",humanGovernorOverride:true}:{}};
  state.validation = validated?{valid:true,fingerprint:"fingerprint-new",validatedAt:new Date().toISOString()}:null;
  state.reviewSession={sessionId:"review-1",proposalFingerprint:reviewed?"fingerprint-new":"fingerprint-old",aggregate:{verdict:"APPROVE"},attestation:"MOCK_SERVER_RECEIPT_FOR_DOM_ONLY"};
  state.humanEditContext={priorReviewSessionId:"review-1",priorReviewedFingerprint:"fingerprint-old"};
  state.humanConfirmation=null;
  for(const id of ["humanConfirmCheckbox","humanRewriteConfirmCheckbox","humanEditRiskCheckbox","overrideReviewCheckbox"]){get(id).checked=false;get(id).disabled=false;}
  evaluate("editorDirty = false; submissionInProgress = false");
}
function canSubmit(){evaluate("updateSubmitButton()");return !get("submitBtn").disabled;}
seed({edited:false,reviewed:true});
get("humanConfirmCheckbox").checked=true;
assert.ok(canSubmit(),"unchanged AI-approved proposal needs only the usual final confirmation");
assert.ok(get("humanRewriteConfirmPanel").hidden,"no false human rewriting warning");
seed({edited:true,reviewed:false});
get("humanConfirmCheckbox").checked=true;
get("humanEditRiskCheckbox").checked=true;
assert.ok(!canSubmit(),"rewritten unreviewed proposal must require first human confirmation");
assert.ok(!get("humanRewriteConfirmPanel").hidden,"show human rewrite warning");
get("humanRewriteConfirmCheckbox").checked=true;
assert.ok(canSubmit(),"both confirmations plus stale-AI-review risk acknowledgement unblock valid human override");
get("humanEditRiskCheckbox").checked=false;
assert.ok(!canSubmit(),"stale AI review risk bypass must not be silently weakened");
seed({edited:true,reviewed:true});
get("humanConfirmCheckbox").checked=true;
assert.ok(!canSubmit(),"human rewrite needs double confirmation even after AI re-review");
get("humanRewriteConfirmCheckbox").checked=true;
assert.ok(canSubmit(),"human rewrite with fresh AI approval and both confirmations passes");
get("humanRewriteConfirmCheckbox").checked=false;
evaluate("persistHumanConfirmation()");
assert.strictEqual(state.humanConfirmation.humanRewriteAcknowledgement,false,"persist first acknowledgement separately");
get("humanRewriteConfirmCheckbox").checked=true;
evaluate("persistHumanConfirmation()");
assert.strictEqual(state.humanConfirmation.humanRewriteAcknowledgement,true,"persist confirmed rewrite fingerprint");
assert.strictEqual(state.humanConfirmation.proposalFingerprint,"fingerprint-new");
state.validation={valid:true,fingerprint:"fingerprint-old",validatedAt:new Date().toISOString()};
assert.ok(!canSubmit(),"mismatched validation fingerprint must block submit");
seed({edited:true,reviewed:false});
get("humanConfirmCheckbox").checked=true;
get("humanRewriteConfirmCheckbox").checked=true;
get("humanEditRiskCheckbox").checked=true;
evaluate("markEditorDirty(true)");
assert.ok(!canSubmit(),"unsaved rewrite blocks submission");
assert.strictEqual(state.validation,null,"changing fields invalidates validation");
assert.strictEqual(state.humanConfirmation,null,"changing fields invalidates persisted confirmation");
assert.strictEqual(get("humanRewriteConfirmCheckbox").checked,false,"changing fields resets first confirmation");
assert.strictEqual(get("humanConfirmCheckbox").checked,false,"changing fields resets final confirmation");
seed({edited:false,reviewed:true});
get("humanRewriteSwitch").checked=true;
evaluate("setHumanRewriteEnabled(true)");
assert.strictEqual(get("humanRewritePanel").hidden,false,"explicit checkbox enables editor");
console.log("PASS v1.0 Human Authority: DOM controls, two confirmations, stale review gate, fingerprint, dirty state, opt-in");
