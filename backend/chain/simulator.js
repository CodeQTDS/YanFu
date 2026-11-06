const { ethers } = require("ethers");
const { getProvider } = require("./provider");
const { loadChainConfig } = require("../config/configLoader");

const erc20BalanceAbi = [
  "function balanceOf(address account) view returns(uint256)"
];

function bn(value) {
  return ethers.BigNumber.from(value ?? 0);
}

function sum(values) {
  return (values || []).reduce(
    (total, value) => total.add(bn(value)),
    ethers.constants.Zero
  );
}

// Decode authoritative executable calldata. Never trust historical semantic action
// metadata after an exact Governor override (or for any validation preflight).
const treasuryInterface = new ethers.utils.Interface([
  "function transferETH(address to,uint256 amount)",
  "function batchTransferETH(address[] to,uint256[] amounts)",
  "function transferERC20(address token,address to,uint256 amount)",
  "function batchTransferERC20(address token,address[] to,uint256[] amounts)"
]);

function treasuryOutflow(target, data, config) {
  if (!ethers.utils.isAddress(target) || !ethers.utils.isAddress(config.treasury) ||
      target.toLowerCase() !== config.treasury.toLowerCase()) return null;
  let parsed;
  try { parsed = treasuryInterface.parseTransaction({ data }); }
  catch (_) { return null; } // Unknown calls remain subject to ordinary simulation.
  if (parsed.name === "transferETH") return { asset: "ETH", required: bn(parsed.args[1]) };
  if (parsed.name === "batchTransferETH") return { asset: "ETH", required: sum(parsed.args[1]) };
  if (parsed.name === "transferERC20") return { asset: String(parsed.args[0]).toLowerCase(), required: bn(parsed.args[2]) };
  if (parsed.name === "batchTransferERC20") return { asset: String(parsed.args[0]).toLowerCase(), required: sum(parsed.args[2]) };
  return null;
}

async function treasuryBalancePreflight({ target, data, provider, config, spent }) {
  const outflow = treasuryOutflow(target, data, config);
  if (!outflow) return null;
  const previous = spent.get(outflow.asset) || ethers.constants.Zero;
  const cumulative = previous.add(outflow.required);
  spent.set(outflow.asset, cumulative);
  try {
    const available = outflow.asset === "ETH"
      ? await provider.getBalance(config.treasury)
      : await new ethers.Contract(outflow.asset, erc20BalanceAbi, provider).balanceOf(config.treasury);
    return {
      kind: "treasury-cumulative-balance", asset: outflow.asset,
      required: cumulative.toString(), actionRequired: outflow.required.toString(),
      available: available.toString(), passed: cumulative.lte(available)
    };
  } catch (error) {
    // Fail closed on a balance we cannot establish. The simulation cannot
    // prove sufficient funds in the absence of reliable chain evidence.
    return { kind: "treasury-cumulative-balance", asset: outflow.asset,
      required: cumulative.toString(), passed: false, error: `Balance unavailable: ${error.message}` };
  }
}

async function simulateProposalCalls(proposal) {
  const provider = getProvider();
  const config = loadChainConfig();
  const results = [];
  const spent = new Map();

  for (let index = 0; index < (proposal.targets || []).length; index++) {
    const target = proposal.targets[index];
    const data = proposal.calldatas[index];
    const value = proposal.values[index] || "0";

    const code = ethers.utils.isAddress(target)
      ? await provider.getCode(target)
      : "0x";

    if (code === "0x") {
      results.push({
        index,
        target,
        success: false,
        blocker: true,
        error: "Target has no deployed contract code"
      });
      continue;
    }

    let balancePreflight = null;
    try {
      balancePreflight = await treasuryBalancePreflight({ target, data, provider, config, spent });
    } catch (error) {
      balancePreflight = {
        kind: "treasury-balance-preflight",
        passed: false,
        error: error.message
      };
    }

    if (balancePreflight?.passed === false) {
      results.push({
        index,
        target,
        success: false,
        blocker: true,
        preflight: balancePreflight,
        error: balancePreflight.error || `${balancePreflight.asset === "ETH" ? "Treasury ETH" : "Treasury token"} balance is insufficient: required ${balancePreflight.required}, available ${balancePreflight.available}`
      });
      continue;
    }

    try {
      const returnData = await provider.call({
        from: config.timelock,
        to: target,
        data,
        value: ethers.BigNumber.from(value)
      });

      results.push({
        index,
        target,
        success: true,
        blocker: false,
        ...(balancePreflight ? { preflight: balancePreflight } : {}),
        returnData
      });
    } catch (error) {
      results.push({
        index,
        target,
        success: false,
        blocker: true,
        ...(balancePreflight ? { preflight: balancePreflight } : {}),
        error: error.error?.message || error.reason || error.message
      });
    }
  }

  return {
    simulatedAt: new Date().toISOString(),
    caller: config.timelock,
    allSuccessful: results.every(item => item.success),
    results,
    caveat: "Creating a Governor proposal does not execute its actions. All funding checks describe the current chain state, not future execution. Cumulative known Treasury outflows are decoded from actual calldata; other calls are independently tested with eth_call against current chain state. This is not an atomic batch simulation or a guarantee of future execution success."
  };
}

module.exports = {
  simulateProposalCalls,
  treasuryBalancePreflight
};
