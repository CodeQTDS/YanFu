'use strict';
const vm=require('vm'),fs=require('fs'),path=require('path'),assert=require('assert');
const dir=process.env.YANFU_ROOT || [path.join(__dirname,'..'),path.join(__dirname,'project','YANFU_GOVERNANCE_COMPILER')].find(x=>fs.existsSync(path.join(x,'package.json')));
const src=fs.readFileSync(path.join(dir,'backend/chain/simulator.js'),'utf8');
const cfg={treasury:'0x'+'1'.repeat(40),timelock:'0x'+'2'.repeat(40)};
let balance=100n,tokenBalance=200n,deadCode=new Set(),revertTargets=new Set();
const makeBN=x=>{const n=BigInt(x&&typeof x==='object'&&'n'in x?x.n:x);return {n,toString:()=>n.toString(),add:y=>makeBN(n+BigInt(y.n??y)),lte:y=>n<=BigInt(y.n??y)}};
const prov={getBalance:async()=>makeBN(balance),getCode:async(addr)=>deadCode.has(addr.toLowerCase())?'0x':'0x6000',call:async({to})=>{if(revertTargets.has(to.toLowerCase()))throw new Error('EVM revert');return '0x'}};
const fakeEthers={BigNumber:{from:makeBN},constants:{Zero:makeBN(0)},utils:{isAddress:s=>/^0x[0-9a-fA-F]{40}$/.test(String(s)),Interface:class {parseTransaction({data}){const [kind,...arg]=data.split('|');if(kind==='eth')return {name:'transferETH',args:['0x'+'0'.repeat(40),makeBN(arg[0])]};if(kind==='ethBatch')return {name:'batchTransferETH',args:[[],arg[0].split(',').map(makeBN)]};if(kind==='token')return {name:'transferERC20',args:[arg[0],'0x'+'0'.repeat(40),makeBN(arg[1])]};if(kind==='tokenBatch')return {name:'batchTransferERC20',args:[arg[0],[],arg[1].split(',').map(makeBN)]};throw Error('unknown ABI selector')}}},Contract:class{async balanceOf(){return makeBN(tokenBalance)}}};
const mod={exports:{}};vm.runInNewContext(src,{require:key=>({'ethers':{ethers:fakeEthers},'./provider':{getProvider:()=>prov},'../config/configLoader':{loadChainConfig:()=>cfg}}[key]),module:mod,exports:mod.exports,Date,Map,Promise,BigInt,Error,Number,String,Array}, {filename:'backend/chain/simulator.js'});
const sim=mod.exports;const tests=[];function record(id,cb){return cb().then(()=>tests.push({id,status:'PASS'})).catch(e=>tests.push({id,status:'FAIL',error:e.message}))}
const mk=(arr)=>({targets:arr.map(()=>cfg.treasury),values:arr.map(()=>'0'),calldatas:arr});
(async()=>{
 for(let count=1;count<=90;count++){
  balance=BigInt(count);const one=mk([`eth|${count}`]);
  await record(`ether-exact-balance-${count}`,async()=>{const x=await sim.simulateProposalCalls(one);assert.strictEqual(x.allSuccessful,true)});
  if(count>1)await record(`ether-exceeds-by-one-${count}`,async()=>{const x=await sim.simulateProposalCalls(mk([`eth|${count+1}`]));assert.strictEqual(x.allSuccessful,false)});
  await record(`ether-cumulative-block-${count}`,async()=>{const x=await sim.simulateProposalCalls(mk([`eth|${count}`,`eth|1`]));assert.strictEqual(x.results[0].success,true);assert.strictEqual(x.results[1].success,false)});
 }
 balance=100n;tokenBalance=100n;
 await record('eth-batch-sufficient',async()=>assert.strictEqual((await sim.simulateProposalCalls(mk(['ethBatch|20,30,40']))).allSuccessful,true));
 await record('eth-batch-insufficient',async()=>assert.strictEqual((await sim.simulateProposalCalls(mk(['ethBatch|20,40,60']))).allSuccessful,false));
 await record('erc20-cumulative-block',async()=>{const p=mk([`token|${'0x'+'3'.repeat(40)}|60`,`token|${'0x'+'3'.repeat(40)}|50`]);const r=await sim.simulateProposalCalls(p);assert.strictEqual(r.results[0].success,true);assert.strictEqual(r.results[1].success,false)});
 deadCode.add(cfg.treasury.toLowerCase());await record('target-without-contract-code',async()=>assert.strictEqual((await sim.simulateProposalCalls(mk(['eth|1']))).allSuccessful,false));deadCode.clear();
 revertTargets.add(cfg.treasury.toLowerCase());await record('eth-call-revert-rejected',async()=>assert.strictEqual((await sim.simulateProposalCalls(mk(['eth|1']))).allSuccessful,false));revertTargets.clear();
 const result={tests,total:tests.length,passed:tests.filter(x=>x.status==='PASS').length,failed:tests.filter(x=>x.status==='FAIL').length,limitations:'Provider, ethers and EVM eth_call were mocked. Verifies simulator control flow and cumulative preflight, not real RPC, Solidity behavior, or atomic state transitions.'};fs.writeFileSync(path.join(__dirname,'YANFU_v1.0_SIMULATOR_MOCK_RESULTS.json'),JSON.stringify(result,null,2));console.log({total:result.total,passed:result.passed,failed:result.failed});if(result.failed)process.exitCode=1;
})();
