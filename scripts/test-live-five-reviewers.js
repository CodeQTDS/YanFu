"use strict";
// Explicit opt-in live integration. Never deploys or submits a proposal.
const fs = require("fs");
const path = require("path");
const root=path.resolve(__dirname,"..");
const config=JSON.parse(fs.readFileSync(path.join(root,"config/app.config.json"),"utf8"));
const base=String(process.env.YANFU_TEST_API_BASE || config.frontend?.apiBaseUrl || "http://localhost:3000").replace(/\/+$/,"");
const MODEL=process.env.YANFU_FIVE_REVIEW_MODEL || "modelscope:qwen3.5-35b-a3b";
const roles=["general-governance","treasury-governance","intent-fidelity","security-execution","governance-mechanism"];
async function post(route,body){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),Number(process.env.YANFU_TEST_TIMEOUT_MS||1200000));
 try {
  const res=await fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
  const json=await res.json();
  if(!res.ok || json.success===false)throw Error(`${route}: HTTP ${res.status}: ${json.error||json.message||"request failed"}`);
  return json;
 }finally{clearTimeout(timeout)}
}
(async()=>{
 const text='Create exactly one governance proposal to set the DAOSettings message to "YanFu release review integration check". Do not transfer any funds or change governance voting parameters.';
 const proposal=(await post('/api/generate',{text,model:MODEL})).proposal;
 const analysis=(await post('/api/analyze',{proposal,model:MODEL})).analysis;
 const assignments=roles.map(profileId=>({model:MODEL,profileId}));
 const json=await post('/api/review/session',{proposal,analysis,reviewers:assignments,models:assignments.map(x=>x.model),roundContext:{round:1}});
 const session=json.reviewSession;
 if(!session||!Array.isArray(session.reviews)||session.reviews.length!==5)throw Error('Expected five reviewer results');
 const actual=session.reviewerSelection||[];
 for(const entry of assignments){if(!actual.some(x=>x.profileId===entry.profileId&&x.model===entry.model))throw Error('Missing role assignment: '+entry.profileId)}
 if(session.reviews.some(r=>r.status==='ERROR'))throw Error('At least one reviewer failed');
 if(!['APPROVE','NEEDS_CHANGES','REJECT'].includes(session.aggregate?.verdict))throw Error('Unknown aggregate verdict');
 console.log(JSON.stringify({status:'PASS',reviewers:session.reviews.length,model:MODEL,roles,aggregateVerdict:session.aggregate.verdict,disclaimer:'Verdict differences are not required; no on-chain submission occurred'},null,2));
})().catch(e=>{console.error('LIVE FIVE REVIEWER FAIL:',e.message);process.exitCode=1});
