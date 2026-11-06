"use strict";
const assert = require('assert');
const hre = require('hardhat');
const { ethers, network, artifacts } = hre;
const { deployContracts } = require('../scripts/deploy');
const eth = ethers.utils.parseEther;
const base = { timelockMinDelaySeconds: 120, treasuryTokenAllocation: '900000', openExecutor: true };
async function minePast(block) {
  const current = await ethers.provider.getBlockNumber();
  if (current <= Number(block)) await network.provider.send('hardhat_mine', [ethers.utils.hexValue(Number(block) - current + 1)]);
}
async function passed(f, targets, data, label) {
  const description = label;
  const values = targets.map(() => 0);
  const hash = ethers.utils.id(description);
  const id = await f.governor.hashProposal(targets, values, data, hash);
  await (await f.governor.propose(targets, values, data, description)).wait();
  assert.equal(await f.governor.state(id), 0, 'Pending');
  await minePast(await f.governor.proposalSnapshot(id));
  assert.equal(await f.governor.state(id), 1, 'Active');
  await (await f.governor.castVote(id, 1)).wait();
  await assert.rejects(f.governor.castVote(id, 1), /vote already cast/);
  await minePast(await f.governor.proposalDeadline(id));
  assert.equal(await f.governor.state(id), 4, 'Succeeded');
  return { targets, values, data, hash, id };
}
async function queue(f, p) {
  await (await f.governor.queue(p.targets, p.values, p.data, p.hash)).wait();
  assert.equal(await f.governor.state(p.id), 5, 'Queued');
}
async function execute(f, p) { return (await f.governor.execute(p.targets, p.values, p.data, p.hash)).wait(); }
async function ready() { await network.provider.send('evm_increaseTime', [121]); await network.provider.send('evm_mine'); }
async function fixture(openExecutor = true) {
  const f = await deployContracts({ deploymentConfig: { ...base, openExecutor }, writeConfig: false, quiet: true });
  await (await f.token.delegate(f.deployer.address)).wait();
  await (await f.deployer.sendTransaction({ to: f.treasury.address, value: eth('5') })).wait();
  return f;
}
describe('Real Governor / Timelock execution', function () {
  this.timeout(60000);
  beforeEach(async () => network.provider.send('hardhat_reset'));
  it('matches freshly deployed Treasury runtime bytecode to the compiled artifact', async () => {
    const f = await fixture();
    const artifact = await artifacts.readArtifact('Treasury');
    assert.equal(await ethers.provider.getCode(f.treasury.address), artifact.deployedBytecode);
  });
  for (const open of [true, false]) it(`executes ETH + seven-recipient 280 MTK batch + settings with openExecutor=${open}`, async () => {
    const f = await fixture(open);
    const recipients = (await ethers.getSigners()).slice(1, 8).map(s => s.address);
    const amounts = [10,20,30,40,50,60,70].map(n => eth(String(n)));
    const before = await ethers.provider.getBalance(recipients[0]);
    const p = await passed(f, [f.treasury.address, f.treasury.address, f.daoSettings.address], [
      f.treasury.interface.encodeFunctionData('transferETH', [recipients[0], eth('1')]),
      f.treasury.interface.encodeFunctionData('batchTransferERC20', [f.token.address, recipients, amounts]),
      f.daoSettings.interface.encodeFunctionData('setMessage', ['Executed through governance'])
    ], 'Lifecycle exact batch');
    assert((await f.token.balanceOf(recipients[0])).isZero(), 'propose/vote must not transfer');
    await queue(f, p);
    await assert.rejects(execute(f, p), /not ready/);
    await ready(); await execute(f, p);
    assert.equal(await f.governor.state(p.id), 7, 'Executed');
    assert((await ethers.provider.getBalance(recipients[0])).sub(before).eq(eth('1')));
    for (let i=0;i<recipients.length;i++) assert((await f.token.balanceOf(recipients[i])).eq(amounts[i]));
    assert((await f.token.balanceOf(f.treasury.address)).eq(eth('899720')));
    assert.equal(await f.daoSettings.message(), 'Executed through governance');
    await assert.rejects(execute(f, p), /not successful|already|not ready/);
  });
  it('rolls back earlier settings and ERC20 transfers when the final batch transfer fails', async () => {
    const f = await fixture();
    const [,a,b] = await ethers.getSigners();
    const p = await passed(f, [f.daoSettings.address, f.treasury.address], [
      f.daoSettings.interface.encodeFunctionData('setRewardRate', [77]),
      f.treasury.interface.encodeFunctionData('batchTransferERC20', [f.token.address, [a.address,b.address], [eth('800000'),eth('200000')]])
    ], 'Atomic ERC20 rollback');
    await queue(f,p); await ready();
    await assert.rejects(execute(f,p), /underlying transaction reverted/);
    assert.equal((await f.daoSettings.rewardRate()).toString(), '10');
    assert((await f.token.balanceOf(a.address)).isZero());
    assert((await f.token.balanceOf(f.treasury.address)).eq(eth('900000')));
    assert.equal(await f.governor.state(p.id),5);
  });
  it('enforces governance-only settings and changes voting parameters and quorum through Timelock', async () => {
    const f=await fixture();
    await assert.rejects(f.governor.setVotingPeriod(12), /onlyGovernance/);
    await assert.rejects(f.daoSettings.setRewardRate(20), /NOT_TIMELOCK/);
    const names=['setVotingDelay','setVotingPeriod','setProposalThreshold','updateQuorumNumerator'];
    const args=[2,12,eth('1'),5];
    const p=await passed(f,names.map(()=>f.governor.address),names.map((n,i)=>f.governor.interface.encodeFunctionData(n,[args[i]])),'Governance settings');
    await queue(f,p); await ready(); await execute(f,p);
    assert.equal((await f.governor.votingDelay()).toString(),'2');
    assert.equal((await f.governor.votingPeriod()).toString(),'12');
    assert((await f.governor.proposalThreshold()).eq(eth('1')));
    assert.equal((await f.governor['quorumNumerator()']()).toString(),'5');
    await network.provider.send('evm_mine');
    assert((await f.governor.quorum((await ethers.provider.getBlockNumber())-1)).eq(eth('50000')));
    const [,outsider]=await ethers.getSigners();
    await assert.rejects(f.governor.connect(outsider).propose([f.daoSettings.address],[0],[f.daoSettings.interface.encodeFunctionData('setRewardRate',[11])],'Below threshold'),/below proposal threshold/);
  });
  it('defeats proposals without quorum and rejects unauthorized Treasury and Timelock calls', async () => {
    const f=await fixture(); const [,other]=await ethers.getSigners();
    const data=f.daoSettings.interface.encodeFunctionData('setRewardRate',[15]);
    await assert.rejects(f.treasury.connect(other).transferETH(other.address,1),/NOT TIMELOCK/);
    await assert.rejects(f.timelock.connect(other).schedule(f.daoSettings.address,0,data,ethers.constants.HashZero,ethers.utils.id('x'),120),/missing role/);
    await (await f.governor.propose([f.daoSettings.address],[0],[data],'No votes')).wait();
    const id=await f.governor.hashProposal([f.daoSettings.address],[0],[data],ethers.utils.id('No votes'));
    await minePast(await f.governor.proposalDeadline(id));
    assert.equal(await f.governor.state(id),3);
    await assert.rejects(f.governor.queue([f.daoSettings.address],[0],[data],ethers.utils.id('No votes')),/not successful/);
  });
  it('blocks queue after proposer role loss and recovers after explicit admin restoration', async () => {
    const f=await fixture();
    const p=await passed(f,[f.daoSettings.address],[f.daoSettings.interface.encodeFunctionData('setRewardRate',[19])],'Role recovery');
    const role=await f.timelock.PROPOSER_ROLE();
    await (await f.timelock.revokeRole(role,f.governor.address)).wait();
    await assert.rejects(queue(f,p),/missing role/);
    await (await f.timelock.grantRole(role,f.governor.address)).wait();
    await queue(f,p); await ready(); await execute(f,p);
    assert.equal((await f.daoSettings.rewardRate()).toString(),'19');
  });
  it('cancels a queued operation using an explicitly granted canceller role', async () => {
    const f=await fixture();
    const p=await passed(f,[f.daoSettings.address],[f.daoSettings.interface.encodeFunctionData('setRewardRate',[99])],'Cancel queued');
    await queue(f,p);
    const operation=await f.timelock.hashOperationBatch(p.targets,p.values,p.data,ethers.constants.HashZero,p.hash);
    await assert.rejects(f.timelock.cancel(operation),/missing role/);
    await (await f.timelock.grantRole(await f.timelock.CANCELLER_ROLE(),f.deployer.address)).wait();
    await (await f.timelock.cancel(operation)).wait();
    assert.equal(await f.governor.state(p.id),2);
    await ready(); await assert.rejects(execute(f,p),/not successful/);
  });
});
