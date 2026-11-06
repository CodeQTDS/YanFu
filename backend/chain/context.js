const { ethers } = require("ethers");
const { getProvider } = require("./provider");
const { loadChainConfig, loadRegisteredContracts } = require("../config/configLoader");

const governorAbi = [
  "function votingDelay() view returns(uint256)",
  "function votingPeriod() view returns(uint256)",
  "function proposalThreshold() view returns(uint256)",
  "function quorum(uint256 blockNumber) view returns(uint256)",
  "function quorumNumerator() view returns(uint256)"
];

const timelockAbi = [
  "function getMinDelay() view returns(uint256)"
];

const tokenAbi = [
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address account) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)"
];

const settingsAbi = [
  "function rewardRate() view returns(uint256)",
  "function message() view returns(string)"
];

async function safe(label, fn) {
  try {
    return await fn();
  } catch (error) {
    return { unavailable: true, label, error: error.message };
  }
}

async function contractStatus(provider, address) {
  if (!address || !ethers.utils.isAddress(address)) {
    return { address: address || null, validAddress: false, hasCode: false };
  }
  const code = await provider.getCode(address);
  return {
    address,
    validAddress: true,
    hasCode: code !== "0x",
    codeSizeBytes: Math.max(0, (code.length - 2) / 2)
  };
}

async function getChainContext() {
  const config = loadChainConfig();
  const registeredContracts = loadRegisteredContracts();
  const provider = getProvider();
  const network = await provider.getNetwork();
  const block = await provider.getBlock("latest");

  const governor = new ethers.Contract(config.governor, governorAbi, provider);
  const timelock = new ethers.Contract(config.timelock, timelockAbi, provider);
  const token = new ethers.Contract(config.token, tokenAbi, provider);
  const settings = new ethers.Contract(config.daoSettings, settingsAbi, provider);

  const [
    votingDelay,
    votingPeriod,
    proposalThreshold,
    quorum,
    quorumNumerator,
    minDelay,
    totalSupply,
    tokenDecimals,
    tokenSymbol,
    treasuryTokenBalance,
    treasuryEthBalance,
    rewardRate,
    message,
    contracts
  ] = await Promise.all([
    safe("governor.votingDelay", () => governor.votingDelay().then(v => v.toString())),
    safe("governor.votingPeriod", () => governor.votingPeriod().then(v => v.toString())),
    safe("governor.proposalThreshold", () => governor.proposalThreshold().then(v => v.toString())),
    safe("governor.quorum", () => governor.quorum(Math.max(0, block.number - 1)).then(v => v.toString())),
    safe("governor.quorumNumerator", () => governor.quorumNumerator().then(v => v.toString())),
    safe("timelock.getMinDelay", () => timelock.getMinDelay().then(v => v.toString())),
    safe("token.totalSupply", () => token.totalSupply().then(v => v.toString())),
    safe("token.decimals", () => token.decimals()),
    safe("token.symbol", () => token.symbol()),
    safe("token.balanceOf(treasury)", () => token.balanceOf(config.treasury).then(v => v.toString())),
    safe("provider.getBalance(treasury)", () => provider.getBalance(config.treasury).then(v => v.toString())),
    safe("daoSettings.rewardRate", () => settings.rewardRate().then(v => v.toString())),
    safe("daoSettings.message", () => settings.message()),
    Promise.all(
      Object.entries({
        token: config.token,
        governor: config.governor,
        timelock: config.timelock,
        treasury: config.treasury,
        contractFactory: config.contractFactory,
        daoSettings: config.daoSettings,
        ...Object.fromEntries((registeredContracts.contracts || [])
          .filter(item => item.enabled === true)
          .map(item => [
            `registered:${item.id}`,
            item.address || (item.addressRef ? config[item.addressRef] : null)
          ]))
      }).map(async ([name, address]) => [name, await contractStatus(provider, address)])
    ).then(entries => Object.fromEntries(entries))
  ]);

  return {
    observedAt: new Date().toISOString(),
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    chainId: Number(network.chainId),
    expectedChainId: Number(config.chainId),
    rpcUrl: config.rpcUrl,
    addresses: {
      token: config.token,
      governor: config.governor,
      timelock: config.timelock,
      treasury: config.treasury,
      contractFactory: config.contractFactory,
      daoSettings: config.daoSettings
    },
    governance: {
      votingDelay,
      votingPeriod,
      proposalThreshold,
      quorum,
      quorumNumerator,
      timelockMinDelay: minDelay
    },
    token: {
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      totalSupply,
      treasuryBalance: treasuryTokenBalance
    },
    treasury: {
      ethBalanceWei: treasuryEthBalance,
      ethBalance: typeof treasuryEthBalance === "string"
        ? ethers.utils.formatEther(treasuryEthBalance)
        : treasuryEthBalance
    },
    daoSettings: {
      rewardRate,
      message
    },
    contracts
  };
}

module.exports = {
  getChainContext,
  contractStatus
};
