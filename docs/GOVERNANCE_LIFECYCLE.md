# Local governance lifecycle

The web app prepares and submits proposals. Voting, queueing and execution are separate transactions. Use the following console exercise only on your disposable Hardhat chain, after `npm run setup`, `npm run node` and `npm run deploy`.

```sh
npx hardhat console --network localhost
```

Paste each line into the console, waiting for completion. This creates a **separate demonstration proposal**; it does not manage a previously submitted UI proposal.

```js
const cfg = require('./config/chain.config.json');
const [deployer] = await ethers.getSigners();
const token = await ethers.getContractAt('MyToken', cfg.token);
const governor = await ethers.getContractAt('MyGovernor', cfg.governor);
const settings = await ethers.getContractAt('DAOSettings', cfg.daoSettings);
const timelock = await ethers.getContractAt('TimelockController', cfg.timelock);
await (await token.delegate(deployer.address)).wait();
const targets = [settings.address];
const values = [0];
const calldatas = [settings.interface.encodeFunctionData('setMessage', ['Hello from YanFu'])];
const description = 'YanFu local message exercise ' + Date.now();
const descriptionHash = ethers.utils.id(description);
const id = await governor.hashProposal(targets, values, calldatas, descriptionHash);
await (await governor.propose(targets, values, calldatas, description)).wait();
const minePast = async (block) => { const current = await ethers.provider.getBlockNumber(); if (current <= Number(block)) await network.provider.send('hardhat_mine', [ethers.utils.hexValue(Number(block) - current + 1)]); };
await minePast(await governor.proposalSnapshot(id));
await (await governor.castVote(id, 1)).wait();
await minePast(await governor.proposalDeadline(id));
await governor.state(id); // 4 = Succeeded
await (await governor.queue(targets, values, calldatas, descriptionHash)).wait();
await network.provider.send('evm_increaseTime', [(await timelock.getMinDelay()).toNumber() + 1]);
await network.provider.send('evm_mine');
await (await governor.execute(targets, values, calldatas, descriptionHash)).wait();
await governor.state(id); // 7 = Executed
await settings.message(); // Hello from YanFu
```

Default deployment gives the deployer 100,000 MTK and requires 4% quorum (40,000 of 1,000,000 MTK). Delegation must happen before the proposal snapshot; holding tokens alone is not voting power. These helpers advance local blocks/time because the development node does not continually mine. They are not public-network shortcuts.

To manage a proposal already submitted in the UI, use its **exact** targets, values, calldatas and description instead of creating the demonstration proposal. Recompute `descriptionHash` and `id` from those values. Do not call `propose` again. If the snapshot has passed without delegation, voting power cannot be retroactively added to that snapshot.

For a local ETH-transfer proposal, first fund the Treasury using a disposable account:

```js
await (await deployer.sendTransaction({to: cfg.treasury, value: ethers.utils.parseEther('2')})).wait();
```

A successful submission, vote or queue operation does not transfer funds. Execution must succeed after the delay. Changes to roles, balances, quorum or voting parameters can prevent execution; review each transaction result.
