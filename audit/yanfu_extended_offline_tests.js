'use strict';
// Independent dependency-free regression runner for the canonical YanFu v1.0 source.
// Does not contact AI providers, start an EVM, or create blockchain transactions.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Module=require('module');
const root=process.env.YANFU_ROOT || [path.join(__dirname,'..'),path.join(__dirname,'project','YANFU_GOVERNANCE_COMPILER')].find(x=>fs.existsSync(path.join(x,'package.json')));
const cases=[]; const findings=[]; let passed=0, failed=0;
function test(group,id,fn){try{fn();cases.push({group,id,status:'PASS'});passed++}catch(e){cases.push({group,id,status:'FAIL',error:e.message});failed++}}
const fakeBN=(str)=>{
 const val=typeof str==='object'&&str!==null&&'n'in str?str.n:BigInt(String(str));
 return {n:val, lt:v=>val<BigInt(v.n??v), gt:v=>val>BigInt(v.n??v), lte:v=>val<=BigInt(v.n??v), add:v=>fakeBN(val+BigInt(v.n??v)), toString:()=>String(val)};
};
const fakeEthers={
 utils:{
  isAddress:s=>/^0x[a-fA-F0-9]{40}$/.test(String(s)),
  id:s=>'0x'+require('crypto').createHash('sha256').update(s).digest('hex'),
 },
 BigNumber:{from:fakeBN},
 constants:{HashZero:'0x'+'0'.repeat(64),MaxUint256:fakeBN((1n<<256n)-1n),Zero:fakeBN(0)}
};
const originalLoad=Module._load;
Module._load=function(mod,parent,isMain){if(mod==='ethers')return {ethers:fakeEthers};return originalLoad.call(this,mod,parent,isMain)};
const validator=require(path.join(root,'backend/proposal/validator.js'));
const guard=require(path.join(root,'backend/proposal/sourceIntentGuard.js'));
const integrity=require(path.join(root,'backend/proposal/integrity.js'));
const consensus=require(path.join(root,'backend/review/consensus.js'));
const requests=require(path.join(root,'backend/review/requestAdapter.js'));
Module._load=originalLoad;
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const caps=read('config/proposal-elements.json').capabilities;
const reviewers=read('config/reviewers.config.json');
const addr='0x'+'1'.repeat(40),addr2='0x'+'2'.repeat(40),token='0x'+'3'.repeat(40);
const typeValue=(input)=>{
 const s=input.semantic||'';
 if(s==='access-role')return 'PROPOSER_ROLE';
 if(input.type==='address')return input.semantic==='token-address'?token:addr;
 if(input.type==='address[]')return [addr,addr2];
 if(input.type==='uint256[]')return ['10','20'];
 if(input.type==='bool')return true;
 if(input.type==='bytes')return '0x1234';
 if(input.type==='bytes32')return '0x'+'a'.repeat(64);
 if(input.type==='string')return 'test-text';
 if(/^u?int/.test(input.type))return '10';
 return '10';
};
const samplePlan=(cap)=>({status:'ready',operations:[{capabilityId:cap.id,arguments:Object.fromEntries((cap.inputs||[]).map(input=>[input.name,typeValue(input)]))}]});
const sourceForPlan=(plan)=>JSON.stringify(plan.operations[0].arguments);
for(const cap of caps){
 const plan=samplePlan(cap),source=sourceForPlan(plan);
 test('capability-positive',cap.id,()=>{const r=validator.validatePlan({plan,registry:caps,sourceText:source});assert.strictEqual(r.valid,true,r.errors.join('; '))});
 test('capability-unknown-argument',cap.id,()=>{const copy=JSON.parse(JSON.stringify(plan));copy.operations[0].arguments.__illegal_parameter__='foo';const r=validator.validatePlan({plan:copy,registry:caps,sourceText:source});assert.strictEqual(r.valid,false)});
 for(const input of cap.inputs||[]){
  test('capability-required',`${cap.id}.${input.name}`,()=>{const copy=JSON.parse(JSON.stringify(plan));delete copy.operations[0].arguments[input.name];const r=validator.validatePlan({plan:copy,registry:caps,sourceText:source});assert.strictEqual(r.valid,false)});
  if(input.type==='address'||input.type==='address[]')test('capability-malformed-address',`${cap.id}.${input.name}`,()=>{const copy=JSON.parse(JSON.stringify(plan));copy.operations[0].arguments[input.name]=input.type.endsWith('[]')?[addr,'0xdeadbeef']:'0xdeadbeef';const r=validator.validatePlan({plan:copy,registry:caps,sourceText:source});assert.strictEqual(r.valid,false)});
  if(input.type==='uint256')test('capability-invalid-amount',`${cap.id}.${input.name}`,()=>{const copy=JSON.parse(JSON.stringify(plan));copy.operations[0].arguments[input.name]='-7';const r=validator.validatePlan({plan:copy,registry:caps,sourceText:source});assert.strictEqual(r.valid,false)});
 }
}
for(let i=0;i<80;i++){
 let a=Array((i%49)+1).fill(addr),b=a.map((_,j)=>String(j+1));
 const cap=caps.find(x=>x.id==='treasury.batchTransferERC20');
 const ok=samplePlan(cap);ok.operations[0].arguments.recipients=a;ok.operations[0].arguments.amounts=b;
 test('batch-alignment',`length-${i+1}`,()=>{const r=validator.validatePlan({plan:ok,registry:caps,sourceText:sourceForPlan(ok)});assert.strictEqual(r.valid,true,r.errors.join('; '))});
 const bad=JSON.parse(JSON.stringify(ok));bad.operations[0].arguments.amounts.pop();
 test('batch-mismatch',`length-${i+1}`,()=>{const r=validator.validatePlan({plan:bad,registry:caps,sourceText:sourceForPlan(bad)});assert.strictEqual(r.valid,false)});
}
for(const invalid of ['',null,0,{},[],{targets:[],values:[],calldatas:[],description:'x'},{targets:[addr],values:['-1'],calldatas:['0x1234'],description:'x'},{targets:[addr],values:['0'],calldatas:['nonsense'],description:'x'},{targets:[addr],values:['0'],calldatas:['0x1'],description:'x'},{targets:[addr],values:[],calldatas:['0x1234'],description:'x'}]){
 test('governor-shape-reject',`invalid-${JSON.stringify(invalid)}`,()=>{const r=validator.validateGovernorProposalShape(invalid);assert.strictEqual(r.valid,false)});
}
for(let i=1;i<=90;i++){
 const a=10+i,b=11+i;
 const prop={sourceText:`Transfer ${a} MTK from the DAO Treasury to ${addr}.`,targets:[addr],actions:[{target:addr,arguments:{token, to:addr, amount:String(b)},encodedArguments:[token,addr,String(b)]}],plan:{operations:[{capabilityId:'treasury.transferERC20',arguments:{token,to:addr,amount:String(b)}}]}};
 test('intent-numeric-mismatch-protected',`wrong-amount-${a}-${b}`,()=>{const r=guard.sourceIntentConsistencyReview({proposal:prop,registry:caps});assert.strictEqual(r.passed,false,'Wrong amount must trigger source-intent HIGH blocker')});
}
for(let i=0;i<90;i++){
 const p={description:'Transfer tokens',targets:[addr],values:['0'],calldatas:['0x1234'],sourceText:`Send ${i+10} tokens`,metadata:{sourceText:`Send ${i+10} tokens`,chainId:31337}};
 const changed={...p,sourceText:`Send ${i+1000} tokens`,metadata:{sourceText:`Send ${i+1000} tokens`,chainId:1}};
 test('fingerprint-provenance-protected',`source-change-${i}`,()=>assert.notStrictEqual(integrity.proposalFingerprint(p),integrity.proposalFingerprint(changed)));
}
const ver=['APPROVE','NEEDS_CHANGES','REJECT'];
for(let mask=0;mask<243;mask++){
 const arr=[];let x=mask;for(let j=0;j<5;j++){arr.push(ver[x%3]);x=Math.floor(x/3)}
 for(const det of [true,false]){
  test('consensus-truth-table',`mask-${mask}-det-${det}`,()=>{
   const reviews=arr.map((v,index)=>({reviewerId:`r${index}`,verdict:v,confidence:0.8,findings:[],recommendedAdjustments:[]}));
   const evidence={deterministic:{passed:det,findings:[]}};
   const actual=consensus.aggregateReviewSession({reviews,evidence});
   const expected=arr.includes('REJECT')?'REJECT':arr.every(v=>v==='APPROVE')&&det?'APPROVE':'NEEDS_CHANGES';
   assert.strictEqual(actual.verdict,expected);assert.strictEqual(actual.readyForHumanConfirmation,expected==='APPROVE'&&det);
  });
 }
}
const models=read('config/models.config.json').models;
const defaultModel=models[0].id;
for(let n=1;n<=5;n++){
 test('review-selection',`repeat-model-${n}`,()=>{assert.strictEqual(reviewers.limits.requireUniqueModels,false);const specs=Array.from({length:n},(_,i)=>({model:defaultModel,profileId:reviewers.profiles[i].id}));const x=requests.normalizeReviewerRequest({reviewers:specs});assert.deepStrictEqual(x.reviewers,specs)});
}
for(const [i,body,expected] of [
 [0,{reviewers:[{model:defaultModel,profileId:'intent-fidelity'}]},1],
 [1,{models:[defaultModel,defaultModel],profiles:['intent-fidelity','general-governance']},2],
 [2,{model:defaultModel},1],
 [3,{reviewers:[],models:[defaultModel]},1]
 ]){test('review-compatibility',`shape-${i}`,()=>assert.strictEqual(requests.normalizeReviewerRequest(body).reviewers.length,expected))}
let parseCount=0,sourceCount=0;
for(const dir of ['config','test/auto']){
 for(const filename of fs.readdirSync(path.join(root,dir)).filter(x=>x.endsWith('.json'))){test('json-syntax',`${dir}/${filename}`,()=>{JSON.parse(fs.readFileSync(path.join(root,dir,filename),'utf8'));parseCount++})}
}
for(const cap of caps)for(const input of cap.inputs||[])test('capability-type',`${cap.id}.${input.name}`,()=>{assert(/^(address|address\[\]|uint256|uint256\[\]|bool|string|bytes|bytes32)$/.test(input.type),`unsupported type ${input.type}`)});
const report={project:'YanFu Governance Compiler',version:'1.0.0',type:'dependency-free independent adversarial regression',source:'YanFu v1.0 source package',executedAt:new Date().toISOString(),totals:{passed,failed,total:passed+failed},limitations:['A minimal ethers mock is deliberately used for deterministic plan validation','No AI-provider calls, deployed-chain contract calls, Solidity compilation or MetaMask transactions','Original audit exposure cases are inverted; PASS means the formerly unsafe behavior is now rejected'],groups:{},cases,findings:[{id:'YF-AUD-01',group:'intent-numeric-mismatch-protected',description:'Amount substitutions blocked by deterministic source-intent checks in 90 original audit cases.'},{id:'YF-AUD-02',group:'fingerprint-provenance-protected',description:'Review-context fingerprint changes with source request and chain provenance across 90 original audit cases.'}]};
for(const c of cases){const g=report.groups[c.group]||(report.groups[c.group]={passed:0,failed:0});g[c.status==='PASS'?'passed':'failed']++}
fs.writeFileSync(path.join(__dirname,'YANFU_v1.0_EXTENDED_OFFLINE_RESULTS.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({totals:report.totals,groups:report.groups},null,2));if(failed)process.exitCode=1;
