const { ethers } = require("ethers");

function bn(value) {
  try {
    return ethers.BigNumber.from(value ?? 0);
  } catch (_) {
    return ethers.constants.Zero;
  }
}

function pushFinding(findings, severity, category, message, suggestion = null, actionIndex = null) {
  findings.push({
    source: "deterministic-action-analysis",
    severity,
    category,
    ...(actionIndex !== null ? { actionIndex } : {}),
    message,
    ...(suggestion ? { suggestion } : {})
  });
}

function analyzeProposalActions({ proposal, chainContext }) {
  const actions = proposal?.actions || [];
  const findings = [];
  const packCounts = {};
  const governanceChanges = [];
  const authorityChanges = [];
  let treasuryEthOutflowWei = ethers.constants.Zero;
  let treasuryConfiguredTokenOutflow = ethers.constants.Zero;

  actions.forEach((action, index) => {
    const pack = action.pack || "General";
    packCounts[pack] = (packCounts[pack] || 0) + 1;

    if (action.capabilityId === "treasury.transferETH") {
      treasuryEthOutflowWei = treasuryEthOutflowWei.add(bn(action.encodedArguments?.[1]));
    }

    if (action.capabilityId === "treasury.batchTransferETH") {
      for (const amount of action.encodedArguments?.[1] || []) {
        treasuryEthOutflowWei = treasuryEthOutflowWei.add(bn(amount));
      }
    }

    if (action.capabilityId === "treasury.transferERC20") {
      const token = String(action.encodedArguments?.[0] || "").toLowerCase();
      const configuredToken = String(chainContext?.addresses?.token || "").toLowerCase();
      if (token && token === configuredToken) {
        treasuryConfiguredTokenOutflow = treasuryConfiguredTokenOutflow.add(bn(action.encodedArguments?.[2]));
      }
    }

    if (action.capabilityId === "treasury.batchTransferERC20") {
      const token = String(action.encodedArguments?.[0] || "").toLowerCase();
      const configuredToken = String(chainContext?.addresses?.token || "").toLowerCase();
      if (token && token === configuredToken) {
        for (const amount of action.encodedArguments?.[2] || []) {
          treasuryConfiguredTokenOutflow = treasuryConfiguredTokenOutflow.add(bn(amount));
        }
      }
    }

    const governanceCurrent = {
      "governor.setVotingDelay": chainContext?.governance?.votingDelay,
      "governor.setVotingPeriod": chainContext?.governance?.votingPeriod,
      "governor.setProposalThreshold": chainContext?.governance?.proposalThreshold,
      "governor.updateQuorumNumerator": chainContext?.governance?.quorumNumerator,
      "timelock.updateDelay": chainContext?.governance?.timelockMinDelay
    };
    if (Object.prototype.hasOwnProperty.call(governanceCurrent, action.capabilityId)) {
      governanceChanges.push({
        actionIndex: index,
        capabilityId: action.capabilityId,
        currentValue: governanceCurrent[action.capabilityId] ?? null,
        proposedValue: String(action.encodedArguments?.[0] ?? Object.values(action.arguments || {})[0] ?? "")
      });
    }

    if (["timelock.grantRole", "timelock.revokeRole"].includes(action.capabilityId) || action.contractType === "access-control") {
      authorityChanges.push({
        actionIndex: index,
        capabilityId: action.capabilityId,
        target: action.target,
        role: action.encodedArguments?.[0] || action.arguments?.role || null,
        account: action.encodedArguments?.[1] || action.arguments?.account || null,
        effect: String(action.functionName || "").toLowerCase().includes("revoke") ? "REVOKE" : "GRANT"
      });
    }

    if (action.contractType === "uups-proxy") {
      pushFinding(
        findings,
        "HIGH",
        "contract-upgrade",
        `Action ${index} upgrades a registered UUPS-compatible contract at ${action.target}.`,
        "Verify implementation bytecode, storage compatibility, upgrade authorization and initialization calldata before execution.",
        index
      );
    }

    if (["pausable", "ownable", "access-control"].includes(action.contractType)) {
      pushFinding(
        findings,
        "MEDIUM",
        "administrative-authority",
        `Action ${index} performs ${action.functionName} on a ${action.contractType} contract.`,
        "Confirm the Timelock is the intended authority and review the operational consequences.",
        index
      );
    }

    if (String(action.pack || "").toLowerCase().includes("defi")) {
      pushFinding(
        findings,
        "MEDIUM",
        "protocol-specific-defi",
        `Action ${index} is a protocol-specific DeFi call (${action.functionName}).`,
        "Verify the registered ABI, approvals, slippage/minimum-output constraints, recipient, deadline and protocol-specific assumptions.",
        index
      );
    }
  });

  const ethBalanceRaw = chainContext?.treasury?.ethBalanceWei;
  const ethBalanceWei = bn(ethBalanceRaw);
  if (typeof ethBalanceRaw === "string" && treasuryEthOutflowWei.gt(ethBalanceWei)) {
    pushFinding(
      findings,
      "HIGH",
      "aggregate-treasury-eth-outflow",
      `Aggregate Treasury ETH outflow is ${ethers.utils.formatEther(treasuryEthOutflowWei)} ETH, exceeding the current Treasury balance ${ethers.utils.formatEther(ethBalanceWei)} ETH.`,
      "Reduce aggregate ETH payments or fund the Treasury before execution."
    );
  }

  const tokenBalanceRaw = chainContext?.token?.treasuryBalance;
  const tokenBalance = bn(tokenBalanceRaw);
  if (typeof tokenBalanceRaw === "string" && treasuryConfiguredTokenOutflow.gt(tokenBalance)) {
    pushFinding(
      findings,
      "HIGH",
      "aggregate-treasury-token-outflow",
      `Aggregate configured-token outflow exceeds the current Treasury token balance.`,
      "Reduce aggregate token payments or fund the Treasury before execution."
    );
  }

  for (const change of governanceChanges) {
    if (change.currentValue !== null && String(change.currentValue) === String(change.proposedValue)) {
      pushFinding(
        findings,
        "LOW",
        "no-op-governance-change",
        `${change.capabilityId} proposes the same value already configured (${change.proposedValue}).`,
        "Confirm whether the no-op change is intentional.",
        change.actionIndex
      );
    }
  }

  return {
    analyzedAt: new Date().toISOString(),
    packCounts,
    treasury: {
      ethOutflowWei: treasuryEthOutflowWei.toString(),
      ethOutflow: ethers.utils.formatEther(treasuryEthOutflowWei),
      configuredTokenOutflowBaseUnits: treasuryConfiguredTokenOutflow.toString()
    },
    governanceChanges,
    authorityChanges,
    findings,
    hasBlockingFinding: findings.some(item => ["HIGH", "CRITICAL"].includes(String(item.severity).toUpperCase()))
  };
}

module.exports = {
  analyzeProposalActions
};
