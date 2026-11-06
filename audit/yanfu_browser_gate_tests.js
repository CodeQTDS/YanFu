'use strict';
// Re-executes the five original browser review-gate conditions against the
// hardened code, plus an explicit server-receipt tampering verification.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {verifyReviewAttestation,issueReviewAttestation}=require('../backend/review/attestation');
const dir=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(dir,'frontend/assets/js/editor.js'),'utf8');
const partial=src.split('document.addEventListener("DOMContentLoaded"')[0];
const state={proposal:{fingerprint:'original-executable-hash',sourceText:'Transfer 100 MTK',metadata:{sourceText:'Transfer 100 MTK'}},analysis:null,reviewSession:null,validation:null,humanEditContext:null};
const checked={humanConfirmCheckbox:true,humanRewriteConfirmCheckbox:true,overrideReviewCheckbox:false,humanEditRiskCheckbox:false};
const elements=id=>({checked:checked[id]||false,value:'',disabled:false,hidden:false});
const context={module:{exports:{}},document:{getElementById:elements},DAO_STATE:{load:()=>state,save:()=>{}},DAO_UI:{setStatus:()=>{}},appConfig:null,console,Date,Map,Set,JSON,String,Boolean,Number};
vm.runInNewContext(partial+`\nappConfig={workflow:{requireReviewBeforeSubmit:true,requireApprovedReviewForSubmit:true,allowHumanReviewOverride:true,humanEditOverride:{enabled:true,requireFreshValidation:true,requirePreviousReviewSession:true,requireRiskAcknowledgement:true},reviewResultOverride:{enabled:true,requireAcknowledgement:true}}};module.exports={reviewMatchesProposal,reviewGateSatisfied,validationMatchesProposal,confirmationSatisfied,currentSubmissionPath};`,context,{filename:'frontend/assets/js/editor.js'});
const f=context.module.exports;let tests=[];
function t(name,doit){try{doit();tests.push({name,status:'PASS'})}catch(e){tests.push({name,status:'FAIL',error:e.message})}}
t('no-review-blocked',()=>assert.strictEqual(f.reviewGateSatisfied(state),false));
state.validation={valid:true,validatedAt:new Date().toISOString(),fingerprint:state.proposal.fingerprint};
t('validation-fresh',()=>assert.strictEqual(f.validationMatchesProposal(state),true));
state.reviewSession={sessionId:'FORGED-LOCAL-SESSION',proposalFingerprint:state.proposal.fingerprint,aggregate:{verdict:'APPROVE'}};
t('forged-local-session-rejected',()=>{assert.strictEqual(f.reviewGateSatisfied(state),false);assert.strictEqual(f.currentSubmissionPath(state),'BLOCKED')});
state.reviewSession.attestation='fabricated.signature';
t('forged-signature-rejected-by-backend',()=>{assert.strictEqual(verifyReviewAttestation({proposal:state.proposal,reviewSession:state.reviewSession}).valid,false)});
state.proposal.sourceText='Transfer 200 MTK';
t('source-changed-review-blocked',()=>{assert.strictEqual(f.reviewMatchesProposal(state),false);assert.strictEqual(f.reviewGateSatisfied(state),false)});
const report={type:'Re-run original review-state audit against v1.0 receipt checks',tests,limitations:'Browser cache is not cryptographically trusted; final verification happens on the server immediately before opening the wallet.'};
fs.writeFileSync(path.join(__dirname,'YANFU_v1.0_BROWSER_GATE_RESULTS.json'),JSON.stringify(report,null,2));console.log(report);if(tests.some(x=>x.status==='FAIL'))process.exitCode=1;
