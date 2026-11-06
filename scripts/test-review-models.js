"use strict";

// Dependency-free regression suite: mocks network and expensive chain operations.
// Does not make real provider requests or Ethereum calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const models = require(path.join(root, "config/models.config.json"));
const config = require(path.join(root, "config/reviewers.config.json"));
const originalLoad = Module._load;
const calls = [];
const providerMock = {
  get: async () => ({ data: { models: [] } }),
  post: async (url, body, opts) => {
    calls.push({url, body, opts});
    if (url.endsWith("/responses")) {
      return { data: { output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: {output_tokens:20} } };
    }
    if (url.endsWith("/messages")) {
      return { data: { content: [{type:"text",text:'{"ok":true}'}], usage: {output_tokens:10} } };
    }
    return { data: { choices: [{ message: { content: '{"ok":true}' } }], usage: {} } };
  }
};
Module._load = function(request, parent, isMain) {
  if (request === "axios") return providerMock;
  if (parent?.filename && path.resolve(parent.filename) === path.join(root, "backend", "review", "orchestrator.js")) {
    if (request === "./evidence") return { collectReviewEvidence: async () => ({ proposalFingerprint:"fingerprint", deterministic:{ passed:true, findings:[] } }) };
    if (request === "./reviewerEngine") return {
      findProfile: id => config.profiles.find(p => p.id === id),
      runSingleReviewer: async ({reviewerIndex,model,profileId}) => ({
        reviewerId:`reviewer-${reviewerIndex+1}`,reviewerIndex,model,
        profile:{id:profileId},status:"COMPLETED",verdict:"APPROVE",confidence:.95,
        findings:[],recommendedAdjustments:[]
      })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
async function main() {
  assert.equal(config.limits.maxReviewers,5);
  assert.equal(config.limits.requireUniqueModels,false);
  assert.equal(config.limits.requireUniqueModelRolePairs,true);
  assert.equal(new Set(config.profiles.map(p=>p.id)).size, config.profiles.length);
  assert.ok(config.profiles.length>=5);
  assert.equal(new Set(models.models.map(m=>m.id)).size,models.models.length);
  for(const model of models.models) {
    assert.ok(models.providers[model.provider], model.id);
    assert.ok(model.model && model.label,model.id);
  }
  for(const id of ['openai:gpt-6-astra','openai:gpt-6.1-sol','openai:gpt-6-luna','modelscope:qwen3.8-27b','modelscope:glm-5.2','modelscope:deepseek-v4-pro']) {
    assert.ok(models.models.some(x=>x.id===id),`Missing model ${id}`);
  }
  // No modality-specific models in this text-governance catalog.
  for(const m of models.models)assert.ok(!/Image-Edit|AntAngelMed|ACE-Step|XiYanSQL/i.test(m.model));
  const { validateReviewerSelection, reviewProposalSession } = require(path.join(root,'backend/review/orchestrator.js'));
  const sameModelFiveRoles=config.profiles.slice(0,5).map(p=>({model:'modelscope:qwen3.5-27b',profileId:p.id}));
  assert.equal(validateReviewerSelection(sameModelFiveRoles).length,5);
  assert.throws(()=>validateReviewerSelection([...sameModelFiveRoles,sameModelFiveRoles[0]]),/Reviewer count/);
  assert.throws(()=>validateReviewerSelection([sameModelFiveRoles[0],sameModelFiveRoles[0]]),/model and role combinations must be unique/);
  assert.equal(validateReviewerSelection([{model:'modelscope:qwen3.5-27b',profileId:'general-governance'},{model:'modelscope:qwen3.5-35b-a3b',profileId:'general-governance'}]).length,2);
  const session=await reviewProposalSession({proposal:{fingerprint:'fingerprint',sourceText:'test'},reviewers:sameModelFiveRoles});
  assert.equal(session.reviews.length,5);
  assert.equal(session.aggregate.reviewerCount,5);
  assert.equal(session.aggregate.verdict,'APPROVE');
  assert.deepEqual(session.reviewerSelection.map(x=>x.profileId),sameModelFiveRoles.map(x=>x.profileId));
  const {agreementLabel}=require(path.join(root,'backend/review/consensus.js'));
  assert.equal(agreementLabel([{},{},{},{},{}],{APPROVE:3,REJECT:2}),'MAJORITY');
  assert.equal(agreementLabel([{},{},{},{}],{APPROVE:2,REJECT:2}),'SPLIT');
  // Native provider adapters send appropriate endpoints, auth, and JSON output request.
  process.env.OPENAI_API_KEY='synthetic-test-key';
  process.env.ANTHROPIC_API_KEY='synthetic-test-key';
  process.env.MODELSCOPE_API_KEY='synthetic-test-key';
  const { generateJson } = require(path.join(root,'backend/ai/modelClient.js'));
  assert.deepEqual((await generateJson({modelId:'openai:gpt-6-astra',prompt:'Return JSON'})).json,{ok:true});
  const r=calls.at(-1);
  assert.match(r.url,/\/responses$/);
  assert.equal(r.body.model,'gpt-6-astra');
  assert.equal(r.body.max_output_tokens,4096);
  assert.equal(r.body.text.format.type,'json_object');
  assert.ok(!('temperature' in r.body));
  assert.deepEqual((await generateJson({modelId:'anthropic:claude-sonnet-4-6',prompt:'Return JSON'})).json,{ok:true});
  assert.match(calls.at(-1).url,/\/messages$/);
  assert.ok(calls.at(-1).opts.headers['anthropic-version']);
  assert.deepEqual((await generateJson({modelId:'modelscope:qwen3.5-27b',prompt:'Return JSON'})).json,{ok:true});
  assert.match(calls.at(-1).url,/\/chat\/completions$/);
  const page=fs.readFileSync(path.join(root,'frontend/pages/review.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'frontend/assets/js/review.js'),'utf8');
  assert.ok(page.includes('option value="5"'));
  assert.ok(js.includes('model::')===false);
  assert.ok(js.includes('duplicatePair'));
  assert.ok(!js.includes('availableCount < reviewers.length'));
  assert.ok(js.includes('requireUniqueModels')===false);
  console.log('PASS v1.0 review-model regression: 5 role slots, reuse, duplicate pair blocked, unanimous consensus, provider adapters, catalog and UI');
}
main().catch(error => { console.error('FAIL v1.0 review-model regression',error.stack||error);process.exitCode=1; }).finally(()=>{ Module._load=originalLoad; });
