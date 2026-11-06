"use strict";
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const outputDir=path.join(ROOT,'test/auto/results');
fs.mkdirSync(outputDir,{recursive:true});
const steps=[];const begun=new Date().toISOString();
function record(name,status,detail,durationMs){steps.push({name,status,detail,durationMs});console.log(`${status.padEnd(7)} ${name}${detail?` — ${detail}`:''}`)}
function run(name,args,options={}){
 const before=Date.now();const command=process.execPath;
 const r=cp.spawnSync(command,args,{cwd:ROOT,encoding:'utf8',timeout:options.timeout||180000,env:{...process.env,...options.env},maxBuffer:12*1024*1024});
 const combined=String(r.stdout||'')+'\n'+String(r.stderr||'');
 const compact=combined.trim().split(/\r?\n/).slice(-6).join(' | ').slice(0,650);
 record(name,r.status===0?'PASS':'FAIL',r.error?.message||compact,Date.now()-before);
 return r.status===0;
}
function staticChecks(){
 let njs=0,njson=0;
 function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','artifacts','cache','results','.git'].includes(ent.name))continue;
  const f=path.join(dir,ent.name);
  if(ent.isDirectory())walk(f);
  else if(f.endsWith('.js')){const result=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(result.status!==0)throw Error(`${f}: ${result.stderr}`);njs++}
  else if(f.endsWith('.json')){JSON.parse(fs.readFileSync(f,'utf8'));njson++}
 }}
 walk(ROOT);
 const ignore=fs.readFileSync(path.join(ROOT,'.gitignore'),'utf8');
 for(const fragment of ['node_modules/','.env','test/auto/results/'])if(!ignore.includes(fragment))throw Error('Missing .gitignore protection '+fragment);
 record('Source syntax, JSON and .gitignore','PASS',`${njs} JavaScript, ${njson} JSON checked`,null)
}
try{staticChecks()}catch(err){record('Source syntax, JSON and .gitignore','FAIL',err.message,null)}
const mandatory=[
 ['Publication metadata, examples and local setup','scripts/check-publication.js'],
 ['Release case schema','scripts/test-release-cases.js'],
 ['Release exact-argument assertions','scripts/test-release-runner-assertions.js'],
 ['v1.0 smoke compiler/reviewer diagnostics','scripts/test-compiler-diagnostics.js'],
 ['Explicit recipient-address preflight','scripts/test-address-preflight.js'],
 ['Exact Governor re-encoding','scripts/test-reencoding.js'],
 ['Security receipts, intents, API guards','scripts/test-security.js'],
 ['Historical audit defects','audit/yanfu_extended_offline_tests.js'],
 ['Simulator behavior','audit/yanfu_simulator_mock_tests.js'],
 ['Human browser gates','audit/yanfu_browser_gate_tests.js'],
 ['v1.0 reviewer model selection','scripts/test-review-models.js'],
 ['Review role specialization','scripts/test-review-roles.js'],
 ['Review decision autonomy','scripts/test-review-policy.js'],
 ['Human Authority confirmations','scripts/test-human-authority.js']
];
for(const [label,file] of mandatory)run(label,[file]);
const ethersReady=fs.existsSync(path.join(ROOT,'node_modules','ethers'));
if(ethersReady){
 run('Full project checker',['scripts/check-project.js']);
 run('v1.0 capability and registered-template validation',['scripts/test-capabilities.js']);
}else {
 record('Full project checker','SKIP','requires npm install (ethers not available)',0);
 record('v1.0 capability and registered-template validation','SKIP','requires npm install (ethers not available)',0);
}
const wantEvm=process.env.YANFU_RELEASE_EVM==='1';
const wantAI=process.env.YANFU_RELEASE_LIVE_AI==='1';
const wantFive=process.env.YANFU_RELEASE_LIVE_FIVE==='1';
if(wantEvm){
 const hardhat=path.join(ROOT,'node_modules','hardhat','internal','cli','cli.js');
 if(!fs.existsSync(hardhat))record('Hardhat Solidity EVM regression','FAIL','npm install required before EVM checks',0);
 else run('Hardhat Solidity EVM regression',[hardhat,'test'],{timeout:600000});
}else record('Hardhat Solidity EVM regression','SKIP','opt in: set YANFU_RELEASE_EVM=1',0);
if(wantEvm)run('Real HTTP and Hardhat RPC integration',['scripts/test-http-evm.js'],{timeout:120000});
else record('Real HTTP and Hardhat RPC integration','SKIP','opt in: set YANFU_RELEASE_EVM=1; ports 8545 and 3300 must be free',0);
if(wantAI)run('Live 12-case Compile/Analyze/Review smoke',['scripts/run-yanfu-ai-pipeline-test.js'],{env:{YANFU_TEST_TAG:'smoke'},timeout:60*60*1000});
else record('Live Compile/Analyze/Review','SKIP','opt in: set YANFU_RELEASE_LIVE_AI=1; requires backend, chain and providers',0);
if(wantFive)run('Live five-role review integration',['scripts/test-live-five-reviewers.js'],{timeout:60*60*1000});
else record('Live five-role review integration','SKIP','opt in: set YANFU_RELEASE_LIVE_FIVE=1',0);
record('MetaMask signing and website workflow','MANUAL','Follow docs/ACCEPTANCE.md; no automated wallet test',0);
const summary={pass:steps.filter(x=>x.status==='PASS').length,fail:steps.filter(x=>x.status==='FAIL').length,skipped:steps.filter(x=>x.status==='SKIP').length,manual:steps.filter(x=>x.status==='MANUAL').length};
const report={schemaVersion:1,startedAt:begun,finishedAt:new Date().toISOString(),projectVersion:JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version,summary,steps,releaseGate:summary.fail?'FAIL':summary.skipped||summary.manual?'PARTIAL_NONPRODUCTION':'PASS_WITH_MANUAL_CONFIRMATION'};
const output=path.join(outputDir,'yanfu_pre_github_gate_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(`\nRelease gate: ${report.releaseGate} | ${JSON.stringify(summary)}\nReport: ${output}`);
if(summary.fail)process.exitCode=1;
