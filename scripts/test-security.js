"use strict";
const assert = require("assert");
const EventEmitter = require("events");
const {proposalFingerprint}=require("../backend/proposal/integrity");
const {issueReviewAttestation,verifyReviewAttestation}=require("../backend/review/attestation");
const {createApiProtection,localHost}=require("../backend/security/apiProtection");
const {extractExplicitTransferIntent,transferIntentFindings}=require("../backend/proposal/intentAmounts");
const {readFileSync}=require("fs");
const path=require("path");
const assertCase=(name,fn)=>{try{fn();stats.pass++;}catch(e){stats.fail++;stats.errors.push({name,error:e.message})}};
const stats={pass:0,fail:0,errors:[]};
const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
const base={targets:[a],values:['0'],calldatas:['0x1234'],description:'test',sourceText:'Send 10 tokens to '+a,metadata:{sourceText:'Send 10 tokens to '+a,chainId:31337}};
const fp=proposalFingerprint(base);
const session={sessionId:'test-session',proposalFingerprint:fp,aggregate:{verdict:'APPROVE'}};
session.attestation=issueReviewAttestation(session);
for(let i=0;i<60;i++){
  const prop={...base,description:`test-${i}`,metadata:{...base.metadata}};
  const proof={sessionId:`test-session-${i}`,proposalFingerprint:proposalFingerprint(prop),aggregate:{verdict:'APPROVE'}};
  proof.attestation=issueReviewAttestation(proof);
  assertCase('genuine-receipt-'+i,()=>assert(verifyReviewAttestation({proposal:prop,reviewSession:proof}).valid));
  assertCase('tampered-verdict-'+i,()=>assert(!verifyReviewAttestation({proposal:prop,reviewSession:{...proof,aggregate:{verdict:'REJECT'}}}).valid));
  assertCase('tampered-source-'+i,()=>assert(!verifyReviewAttestation({proposal:{...prop,sourceText:'Send 500 tokens'},reviewSession:proof}).valid));
  assertCase('tampered-chain-'+i,()=>assert(!verifyReviewAttestation({proposal:{...prop,metadata:{...prop.metadata,chainId:1}},reviewSession:proof}).valid));
  assertCase('missing-signature-'+i,()=>assert(!verifyReviewAttestation({proposal:prop,reviewSession:{...proof,attestation:''}}).valid));
  const edited={...prop,metadata:{...prop.metadata,editedBy:'HUMAN'},description:'human edited'};
  assertCase('human-edit-valid-prior-'+i,()=>{
    const t=verifyReviewAttestation({proposal:edited,reviewSession:proof,priorReviewedFingerprint:proof.proposalFingerprint});
    assert(t.valid && !t.current);
  });
  assertCase('untrusted-stale-'+i,()=>assert(!verifyReviewAttestation({proposal:{...edited,metadata:{...edited.metadata,editedBy:'AI'}},reviewSession:proof,priorReviewedFingerprint:proof.proposalFingerprint}).valid));
}
for(let i=1;i<=100;i++){
  const src=`Send ${i} tokens to ${a}, ${i+1} tokens to ${b}. The total amount transferred must be exactly ${2*i+1} tokens.`;
  const correct={plan:{operations:[{capabilityId:'treasury.batchTransferERC20',arguments:{recipients:[a,b],amounts:[String(i),String(i+1)]}}]}};
  const wrong={plan:{operations:[{capabilityId:'treasury.batchTransferERC20',arguments:{recipients:[a,b],amounts:[String(i+1),String(i)]}}]}};
  const wrongTotal={plan:{operations:[{capabilityId:'treasury.batchTransferERC20',arguments:{recipients:[a,b],amounts:[String(i),String(i+2)]}}]}};
  assertCase('batch-valid-'+i,()=>assert.equal(transferIntentFindings({sourceText:src,proposal:correct}).length,0));
  assertCase('batch-swapped-'+i,()=>assert(transferIntentFindings({sourceText:src,proposal:wrong}).length>0));
  assertCase('batch-total-changed-'+i,()=>assert(transferIntentFindings({sourceText:src,proposal:wrongTotal}).length>0));
}
assertCase('private-bind-only',()=>{assert(localHost('127.0.0.1'));assert(!localHost('0.0.0.0'));assert(!localHost('192.168.0.1'));});
function mockReq(origin,method='/api/generate',ip='127.0.0.1'){return {path:method,method:'POST',headers:origin?{origin}:{},ip};}
function mockRes(){const x=new EventEmitter();x.code=200;x.headers={};x.set=(k,v)=>{x.headers[k]=v;return x};x.status=v=>{x.code=v;return x};x.json=v=>{x.payload=v;x.emit('finish');return x};x.end=()=>{x.emit('finish');return x};return x;}
for(let i=0;i<60;i++){
  const svc=createApiProtection({env:{YANFU_API_MAX_REQUESTS_PER_MINUTE:'2',YANFU_API_MAX_ACTIVE_AI_REQUESTS:'1'},clock:()=>1_700_000_000_000});
  const allowed=mockRes();let gotNext=false;
  svc.middleware(mockReq('http://localhost:5500'),allowed,()=>{gotNext=true;});
  assertCase('allowed-origin-'+i,()=>assert(gotNext));
  const blocked=mockRes();svc.middleware(mockReq('https://evil.example'),blocked,()=>{});
  assertCase('malicious-origin-'+i,()=>assert.equal(blocked.code,403));
  const busy=mockRes();svc.middleware(mockReq('http://localhost:5500'),busy,()=>{});
  assertCase('concurrency-'+i,()=>assert.equal(busy.code,429));
  allowed.emit('finish');
  const next=mockRes();svc.middleware(mockReq('http://localhost:5500'),next,()=>{});
  const rate=mockRes();svc.middleware(mockReq('http://localhost:5500'),rate,()=>{});
  assertCase('rate-limit-'+i,()=>assert.equal(rate.code,429));
}
const treasury=readFileSync(path.join(__dirname,'../contracts/Treasury.sol'),'utf8');
assertCase('solidity-code-guard-twice',()=>assert((treasury.match(/token\.code\.length > 0/g)||[]).length===2));
assertCase('no-public-bind',()=>assert(readFileSync(path.join(__dirname,'../backend/server.js'),'utf8').includes('if (!localHost(bindHost))')));
const editor=readFileSync(path.join(__dirname,'../frontend/assets/js/editor.js'),'utf8');
assertCase('prewallet-server-receipt',()=>assert(editor.indexOf('"/api/review/verify"')>=0 && editor.indexOf('"/api/review/verify"')<editor.indexOf('DAO_WALLET.submitProposal')));
const result={type:'v1.0 hardening regression',stats,notes:['HMAC receipts and original intent constraints exercised with actual functions','API middleware exercised through simulated Express requests','Solidity source checks are not a substitute for EVM tests','No live provider/wallet tests']};
console.log(JSON.stringify(result,null,2));
if(stats.fail)process.exitCode=1;
