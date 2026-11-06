"use strict";
// Executes the production wallet adapter against a real EVM through an EIP-1193
// test transport. This is NOT the MetaMask extension or a browser UI test.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ethers, network } = require('hardhat');
const { deployContracts } = require('../scripts/deploy');
function adapter(hook = async () => undefined) {
  let sends = 0;
  const ethereum = { request: async request => {
    const override = await hook(request);
    if (override !== undefined) return override;
    if (request.method === 'eth_requestAccounts') return network.provider.send('eth_accounts');
    if (request.method === 'eth_sendTransaction') sends++;
    return network.provider.send(request.method, request.params || []);
  } };
  const context = { window: { ethereum }, ethers, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/assets/js/wallet.js'),'utf8'),context);
  return { wallet: context.window.DAO_WALLET, sends: () => sends };
}
describe('Production wallet adapter / real EVM (not MetaMask)', function () {
  let f, proposal;
  beforeEach(async () => {
    await network.provider.send('hardhat_reset');
    f = await deployContracts({writeConfig:false,quiet:true});
    proposal = { targets:[f.daoSettings.address], values:['0'], calldatas:[f.daoSettings.interface.encodeFunctionData('setMessage',['Wallet payload'])], description:'Exact wallet adapter payload' };
  });
  it('submits the exact displayed Governor arguments and returns the matching on-chain proposal ID', async () => {
    const a=adapter();
    const result=await a.wallet.submitProposal(proposal,f.chainConfig);
    const tx=await ethers.provider.getTransaction(result.txHash);
    const decoded=f.governor.interface.parseTransaction({data:tx.data,value:tx.value});
    assert.equal(decoded.name,'propose');
    assert.deepEqual([...decoded.args[0]],proposal.targets);
    assert.deepEqual(decoded.args[1].map(String),proposal.values);
    assert.deepEqual([...decoded.args[2]],proposal.calldatas);
    assert.equal(decoded.args[3],proposal.description);
    const receipt=await ethers.provider.getTransactionReceipt(result.txHash);
    const event=receipt.logs.map(log=>{try{return f.governor.interface.parseLog(log)}catch{return null}}).find(e=>e?.name==='ProposalCreated');
    assert.equal(event.args.proposalId.toString(),result.proposalId);
    assert.equal(result.actor,f.deployer.address);
    assert.equal(result.chainId,f.chainConfig.chainId);
    assert.equal(await f.governor.state(result.proposalId),0);
    assert.equal(a.sends(),1);
    assert.equal(await f.daoSettings.message(),'Initial DAO message');
  });
  it('blocks wrong chain before sending a transaction', async () => {
    const a=adapter();
    await assert.rejects(a.wallet.submitProposal(proposal,{...f.chainConfig,chainId:1}),/expected chain 1/);
    assert.equal(a.sends(),0);
  });
  it('propagates account permission rejection without sending', async () => {
    const a=adapter(async r=>{if(r.method==='eth_requestAccounts')throw Object.assign(new Error('User rejected account access'),{code:4001});});
    await assert.rejects(a.wallet.submitProposal(proposal,f.chainConfig),/User rejected account access/);
    assert.equal(a.sends(),0);
  });
  it('propagates signing cancellation without recording a proposal', async () => {
    const a=adapter(async r=>{if(r.method==='eth_sendTransaction')throw Object.assign(new Error('User rejected transaction'),{code:4001});});
    await assert.rejects(a.wallet.submitProposal(proposal,f.chainConfig),/User rejected transaction/);
    const id=await f.governor.hashProposal(proposal.targets,proposal.values,proposal.calldatas,ethers.utils.id(proposal.description));
    await assert.rejects(f.governor.state(id),/unknown proposal id/);
  });
  it('propagates a disconnected provider and sends nothing', async () => {
    const a=adapter(async()=>{throw Object.assign(new Error('Wallet disconnected'),{code:4900});});
    await assert.rejects(a.wallet.submitProposal(proposal,f.chainConfig),/Wallet disconnected/);
    assert.equal(a.sends(),0);
  });
});
