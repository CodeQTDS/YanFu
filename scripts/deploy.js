const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function deployContracts({ deploymentConfig = require("../config/deployment.config.json"), writeConfig = true, quiet = false } = {}) {
  const [deployer] = await hre.ethers.getSigners();

  if (!quiet) console.log("Deploying YanFu Governance Compiler contracts with:", deployer.address);

  const Token = await hre.ethers.getContractFactory("MyToken");
  const token = await Token.deploy();
  await token.deployed();

  const Timelock = await hre.ethers.getContractFactory("TimelockController");
  const executors = deploymentConfig.openExecutor
    ? [hre.ethers.constants.AddressZero]
    : [];
  const timelock = await Timelock.deploy(
    Number(deploymentConfig.timelockMinDelaySeconds),
    [],
    executors,
    deployer.address
  );
  await timelock.deployed();

  const Governor = await hre.ethers.getContractFactory("MyGovernor");
  const governor = await Governor.deploy(token.address, timelock.address);
  await governor.deployed();

  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  await (await timelock.grantRole(PROPOSER_ROLE, governor.address)).wait();

  // Governor calls Timelock.executeBatch; a closed executor set must still
  // authorize that caller or every successful proposal becomes unexecutable.
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  const executor = deploymentConfig.openExecutor ? hre.ethers.constants.AddressZero : governor.address;
  await (await timelock.grantRole(EXECUTOR_ROLE, executor)).wait();

  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(timelock.address);
  await treasury.deployed();

  const Factory = await hre.ethers.getContractFactory("DAOContractFactory");
  const contractFactory = await Factory.deploy(timelock.address);
  await contractFactory.deployed();

  const DAOSettings = await hre.ethers.getContractFactory("DAOSettings");
  const daoSettings = await DAOSettings.deploy(timelock.address);
  await daoSettings.deployed();

  const allocation = hre.ethers.utils.parseEther(
    String(deploymentConfig.treasuryTokenAllocation)
  );
  await (await token.transfer(treasury.address, allocation)).wait();

  const network = await hre.ethers.provider.getNetwork();
  const chainConfig = {
    rpcUrl: "http://127.0.0.1:8545",
    chainId: Number(network.chainId),
    token: token.address,
    governor: governor.address,
    timelock: timelock.address,
    treasury: treasury.address,
    contractFactory: contractFactory.address,
    daoSettings: daoSettings.address
  };

  const output = path.resolve(__dirname, "../config/chain.config.json");
  if (writeConfig) fs.writeFileSync(output, JSON.stringify(chainConfig, null, 2) + "\n", "utf8");

  if (!quiet) {
  console.log("\n===== YANFU GOVERNANCE COMPILER DEPLOYED =====");
  console.table(chainConfig);
  console.log("Treasury MTK allocation:", deploymentConfig.treasuryTokenAllocation);
  if (writeConfig) console.log("Updated:", output);
  }
  return { deployer, token, timelock, governor, treasury, contractFactory, daoSettings, chainConfig };
}

module.exports = { deployContracts };

if (require.main === module) deployContracts().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
