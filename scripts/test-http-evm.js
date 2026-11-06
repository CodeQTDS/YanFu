"use strict";
// Real HTTP + local Hardhat RPC. Receipts are synthetic signed test fixtures;
// no model verdict is fabricated or counted as live AI review.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const net=require('net');
const os=require('os');
const crypto=require('crypto');
const {spawn}=require('child_process');
const {ethers}=require('ethers');
const ROOT=path.resolve(__dirname,'..');
let runRoot;
let configPath;
const children=[];
const secret=crypto.randomBytes(48).toString('hex');
process.env.YANFU_REVIEW_ATTESTATION_SECRET=secret;
const {issueReviewAttestation}=require('../backend/review/attestation');
const {proposalFingerprint}=require('../backend/proposal/integrity');
const checks=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function vacant(port){await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(`Port ${port} is occupied; stop the test rather than modifying an existing chain`)));s.listen(port,'127.0.0.1',()=>s.close(resolve));});}
function launch(args,env={}){const p=spawn(process.execPath,args,{cwd:runRoot,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output=(output+b).slice(-6000));p.stderr.on('data',b=>output=(output+b).slice(-6000));children.push(p);return {p,output:()=>output};}
async function waitFor(url,child){for(let n=0;n<100;n++){if(child.p.exitCode!==null)throw Error(`Child exited: ${child.output()}`);try{await fetch(url,{signal:AbortSignal.timeout(500)});return;}catch{}await pause(100);}throw Error('Local service readiness timeout');}
async function request(route,body,origin='http://127.0.0.1:5500'){
 const r=await fetch('http://127.0.0.1:3300'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:r.status,headers:r.headers,data:await r.json()};
}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function main(){
 await vacant(8545);await vacant(3300);
 runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'yanfu-http-'));
 for(const name of ['backend','config','contracts','scripts','artifacts','cache']) { const source=path.join(ROOT,name);if(fs.existsSync(source))fs.cpSync(source,path.join(runRoot,name),{recursive:true}); }
 for(const name of ['hardhat.config.js','package.json'])fs.copyFileSync(path.join(ROOT,name),path.join(runRoot,name));
 fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(runRoot,'node_modules'),'junction');
 configPath=path.join(runRoot,'config/chain.config.json');
 const chain=launch(['node_modules/hardhat/internal/cli/cli.js','node','--hostname','127.0.0.1']);
 await waitFor('http://127.0.0.1:8545',chain);
 const deployment=launch(['node_modules/hardhat/internal/cli/cli.js','run','scripts/deploy.js','--network','localhost']);
 await new Promise((resolve,reject)=>deployment.p.once('exit',c=>c===0?resolve():reject(Error(deployment.output()))));
 const config=JSON.parse(fs.readFileSync(configPath));
 const rpc=new ethers.providers.JsonRpcProvider(config.rpcUrl);
 await (await rpc.getSigner(0).sendTransaction({to:config.treasury,value:ethers.utils.parseEther('5')})).wait();
 const backend=launch(['backend/server.js'],{PORT:'3300',YANFU_LOG_LEVEL:'off'});
 await waitFor('http://127.0.0.1:3300/api/health',backend);
 await check('HTTP health, allowed origin and no-store response',async()=>{const r=await request('/api/health');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('access-control-allow-origin'),'http://127.0.0.1:5500');assert.equal(r.headers.get('etag'),null);});
 await check('HTTP rejects unrelated browser origin',async()=>assert.equal((await request('/api/health',undefined,'https://untrusted.example')).status,403));
 await check('malformed explicit address rejected before any AI request',async()=>{const r=await request('/api/generate',{text:'Transfer 10 MTK to exactly 0x12345',model:'modelscope:qwen3.5-35b-a3b'});assert.equal(r.status,422);assert.equal(r.data.code,'INPUT_CONFLICT');});
 const recipient=await rpc.getSigner(1).getAddress();
 const treasury=new ethers.Contract(config.treasury,['function transferETH(address,uint256)'],rpc);
 const proposal={description:'HTTP current-state ETH validation',sourceText:'',chainId:config.chainId,targets:[config.treasury],values:['0'],calldatas:[treasury.interface.encodeFunctionData('transferETH',[recipient,ethers.utils.parseEther('1')])],metadata:{chainId:config.chainId}};
 proposal.fingerprint=proposalFingerprint(proposal);
 await check('submission validation runs actual Timelock-origin eth_call',async()=>{const r=await request('/api/proposal/validate',{proposal});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.validation.valid,true);assert.equal(r.data.validation.chainContext.chainId,config.chainId);assert.equal(r.data.validation.fingerprint,proposal.fingerprint);});
 await check('aggregate sequential ETH overspending is blocked on live RPC',async()=>{const p={...proposal,targets:[config.treasury,config.treasury],values:['0','0'],calldatas:[1,2].map(()=>treasury.interface.encodeFunctionData('transferETH',[recipient,ethers.utils.parseEther('3')]))};p.fingerprint=proposalFingerprint(p);const r=await request('/api/proposal/validate',{proposal:p});assert.equal(r.status,422);assert.equal(r.data.validation.valid,false);});
 await check('validation rejects a proposal reviewed on another chain',async()=>{const p={...proposal,metadata:{...proposal.metadata,chainId:1}};p.fingerprint=proposalFingerprint(p);const r=await request('/api/proposal/validate',{proposal:p});assert.equal(r.status,422);assert.match(r.data.validation.errors.join(' '),/proposal chain/i);});
 const session={sessionId:'synthetic-http-test',proposalFingerprint:proposal.fingerprint,aggregate:{verdict:'APPROVE'}};
 session.attestation=issueReviewAttestation(session);
 await check('server accepts valid synthetic signed receipt',async()=>{const r=await request('/api/review/verify',{proposal,reviewSession:session});assert.equal(r.status,200);assert.equal(r.data.verification.current,true);});
 await check('server rejects changed signed verdict',async()=>assert.equal((await request('/api/review/verify',{proposal,reviewSession:{...session,aggregate:{verdict:'REJECT'}}})).status,403));
 await check('server rejects tampered signature',async()=>assert.equal((await request('/api/review/verify',{proposal,reviewSession:{...session,attestation:session.attestation.slice(0,-6)+'AAAAAA'}})).status,403));
 await check('server rejects stale source and chain fingerprints',async()=>{for(const change of [{sourceText:'Changed source'},{metadata:{...proposal.metadata,chainId:1}}]){const p={...proposal,...change};p.fingerprint=proposalFingerprint(p);assert.equal((await request('/api/review/verify',{proposal:p,reviewSession:session})).status,403);}});
 await check('exact human rewrite requires explicit prior-review lineage',async()=>{const r=await request('/api/proposal/human-override',{proposal,targets:proposal.targets,values:proposal.values,calldatas:proposal.calldatas,description:'Human revised description'});assert.equal(r.status,200);const p=r.data.proposal;assert.notEqual(p.fingerprint,proposal.fingerprint);assert.equal((await request('/api/review/verify',{proposal:p,reviewSession:session})).status,403);const verified=await request('/api/review/verify',{proposal:p,reviewSession:session,humanEditContext:{priorReviewSessionId:session.sessionId,priorReviewedFingerprint:proposal.fingerprint}});assert.equal(verified.status,200);assert.equal(verified.data.verification.current,false);assert.equal((await request('/api/proposal/validate',{proposal:p})).status,200);});
 console.log(`PASS ${checks.length} real HTTP/RPC integration scenarios; synthetic review receipts, no live AI or MetaMask`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 for(const p of children)if(p.exitCode===null)p.kill('SIGTERM');
 await Promise.all(children.filter(p=>p.exitCode===null).map(p=>new Promise(r=>{p.once('exit',r);setTimeout(()=>{p.kill('SIGKILL');r();},2000).unref();})));
 if(runRoot)fs.rmSync(runRoot,{recursive:true,force:true});
});
