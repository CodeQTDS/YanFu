const { ethers } = require("ethers");
const { findCapability } = require("./capabilityRegistry");
const { normalizeArguments } = require("./validator");
const { resolveAccessRole } = require("./semanticResolvers");

function encodeSemanticValue(value, input) {
  const semantic = input.semantic || "";

  if (semantic === "token-amount") {
    return ethers.utils.parseUnits(String(value), input.decimals ?? 18).toString();
  }
  if (semantic === "token-amount-list") {
    return (value || []).map(item =>
      ethers.utils.parseUnits(String(item), input.decimals ?? 18).toString()
    );
  }
  if (semantic === "ether-amount") {
    return ethers.utils.parseEther(String(value)).toString();
  }
  if (semantic === "ether-amount-list") {
    return (value || []).map(item => ethers.utils.parseEther(String(item)).toString());
  }
  if (semantic === "access-role") {
    const role = resolveAccessRole(value);
    if (!role) throw new Error(`Unknown access-control role: ${value}`);
    return role;
  }
  return value;
}

function expandZipOperation(operation, capability, registry) {
  const expansion = capability.expansion || {};
  const targetCapability = findCapability(registry, expansion.capabilityId);
  if (!targetCapability) {
    throw new Error(`Macro capability ${capability.id} references unknown expansion capability ${expansion.capabilityId}`);
  }

  const sourceArgs = normalizeArguments(capability, operation.arguments || {});
  const mapping = expansion.map || {};
  const sourceNames = Object.values(mapping);
  const arrayNames = sourceNames.filter(name => Array.isArray(sourceArgs[name]));
  if (!arrayNames.length) {
    throw new Error(`Macro capability ${capability.id} has no array arguments to zip`);
  }

  const length = sourceArgs[arrayNames[0]].length;
  for (const name of arrayNames) {
    if (sourceArgs[name].length !== length) {
      throw new Error(`Macro capability ${capability.id} requires equal-length arrays`);
    }
  }

  const expanded = [];
  for (let index = 0; index < length; index++) {
    const args = {};
    for (const [targetName, sourceName] of Object.entries(mapping)) {
      const sourceValue = sourceArgs[sourceName];
      args[targetName] = Array.isArray(sourceValue) ? sourceValue[index] : sourceValue;
    }
    expanded.push({
      capabilityId: targetCapability.id,
      arguments: args,
      _sourceCapabilityId: capability.id,
      _sourceOperationIndex: operation._sourceOperationIndex ?? null,
      _macroIndex: index
    });
  }
  return expanded;
}

function expandOperation(operation, registry, depth = 0) {
  if (depth > 5) throw new Error("Capability expansion exceeded maximum depth");
  const capability = findCapability(registry, operation.capabilityId);
  if (!capability) throw new Error(`Unknown capability: ${operation.capabilityId}`);
  if (!capability.expansion) return [operation];

  if (capability.expansion.mode === "zip") {
    return expandZipOperation(operation, capability, registry)
      .flatMap(item => expandOperation(item, registry, depth + 1));
  }
  throw new Error(`Unsupported capability expansion mode: ${capability.expansion.mode}`);
}

function resolveOperation(operation, registry) {
  const capability = findCapability(registry, operation.capabilityId);
  if (!capability) {
    throw new Error(`Unknown capability: ${operation.capabilityId}`);
  }
  if (capability.expansion) {
    throw new Error(`Macro capability ${capability.id} must be expanded before encoding`);
  }

  const humanArguments = normalizeArguments(capability, operation.arguments || {});
  const encodedArguments = (capability.inputs || []).map(input =>
    encodeSemanticValue(humanArguments[input.name], input)
  );

  const iface = new ethers.utils.Interface([capability.abi]);
  const calldata = iface.encodeFunctionData(
    capability.signature || capability.functionName,
    encodedArguments
  );

  const value = capability.payable
    ? String(operation.value || "0")
    : "0";

  return {
    capabilityId: capability.id,
    sourceCapabilityId: operation._sourceCapabilityId || capability.id,
    sourceOperationIndex: operation._sourceOperationIndex ?? null,
    macroIndex: operation._macroIndex ?? null,
    label: capability.label,
    pack: capability.pack || "General",
    contractType: capability.contractType || "contract-call",
    contract: capability.contract,
    registeredContractId: capability.registeredContractId || null,
    target: capability.address,
    functionName: capability.functionName,
    functionSignature: capability.signature,
    abi: capability.abi,
    arguments: humanArguments,
    encodedArguments,
    value,
    calldata,
    riskProfile: capability.riskProfile || null,
    analysisHints: capability.analysisHints || []
  };
}

function buildGovernorProposal({ plan, registry, description, metadata = {} }) {
  const expandedOperations = (plan.operations || []).flatMap((operation, sourceOperationIndex) =>
    expandOperation({ ...operation, _sourceOperationIndex: sourceOperationIndex }, registry)
  );
  const actions = expandedOperations.map(operation => resolveOperation(operation, registry));

  return {
    description: String(description || plan.description || plan.intentSummary || "DAO governance proposal"),
    actions,
    targets: actions.map(item => item.target),
    values: actions.map(item => item.value),
    calldatas: actions.map(item => item.calldata),
    metadata: {
      ...metadata,
      semanticOperationCount: (plan.operations || []).length,
      executableActionCount: actions.length
    }
  };
}

module.exports = {
  encodeSemanticValue,
  expandOperation,
  resolveOperation,
  buildGovernorProposal
};
