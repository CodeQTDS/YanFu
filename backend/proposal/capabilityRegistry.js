const {
  loadChainConfig,
  loadProposalElements,
  loadContractTypeTemplates,
  loadRegisteredContracts
} = require("../config/configLoader");

function resolveInputs(inputs, chain) {
  return (inputs || []).map(input => ({
    ...input,
    ...(input.defaultRef ? { default: chain[input.defaultRef] } : {})
  }));
}

function normalizeCapability(raw, chain, context = {}) {
  const address = raw.address || (raw.addressRef ? chain[raw.addressRef] : context.address);
  if (!address) {
    throw new Error(`Capability ${raw.id || raw.templateId || "unknown"} cannot resolve target address`);
  }

  return {
    ...raw,
    contract: raw.contract || context.contract || raw.contractType || "RegisteredContract",
    address,
    addressRef: raw.addressRef || context.addressRef || null,
    addressAliases: [
      ...(raw.addressAliases || []),
      ...(context.addressAliases || [])
    ].filter(Boolean),
    registeredContractId: context.registeredContractId || raw.registeredContractId || null,
    inputs: resolveInputs(raw.inputs, chain)
  };
}

function buildRegisteredCapabilities({ chain, registeredContracts, templates }) {
  const templateMap = new Map((templates.templates || []).map(item => [item.templateId, item]));
  const out = [];

  for (const contract of registeredContracts.contracts || []) {
    if (contract.enabled !== true) continue;

    const address = contract.address || (contract.addressRef ? chain[contract.addressRef] : null);
    if (!address) {
      throw new Error(`Registered contract ${contract.id || contract.label || "unknown"} has no address or resolvable addressRef`);
    }

    for (const spec of contract.capabilities || []) {
      if (spec.enabled === false) continue;

      let raw = { ...spec };
      if (spec.templateId) {
        const template = templateMap.get(spec.templateId);
        if (!template) {
          throw new Error(`Registered capability ${spec.id || spec.templateId} references unknown template ${spec.templateId}`);
        }
        raw = {
          ...template,
          ...spec,
          inputs: spec.inputs || template.inputs,
          riskProfile: { ...(template.riskProfile || {}), ...(spec.riskProfile || {}) },
          analysisHints: spec.analysisHints || template.analysisHints || []
        };
      }

      if (!raw.id) {
        const suffix = raw.templateId || raw.functionName || "capability";
        raw.id = `${contract.id}.${suffix}`;
      }

      out.push(normalizeCapability(raw, chain, {
        address,
        addressRef: contract.addressRef || `registered.${contract.id}`,
        contract: contract.label || contract.id,
        addressAliases: [contract.id, contract.label, ...(contract.aliases || [])].filter(Boolean),
        registeredContractId: contract.id
      }));
    }
  }

  return out;
}

function buildCapabilityRegistry(options = {}) {
  const chain = options.chainConfig || loadChainConfig();
  const elements = options.proposalElements || loadProposalElements();
  const templates = options.contractTypeTemplates || loadContractTypeTemplates();
  const registeredContracts = options.registeredContracts || loadRegisteredContracts();

  const builtIns = (elements.capabilities || []).map(raw => normalizeCapability(raw, chain));
  const registered = buildRegisteredCapabilities({ chain, registeredContracts, templates });
  const all = [...builtIns, ...registered];

  const seen = new Set();
  for (const capability of all) {
    if (!capability.id) throw new Error("Every capability must have an id");
    if (seen.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
    seen.add(capability.id);
  }

  return all;
}

function findCapability(registry, id) {
  return registry.find(item => item.id === id) || null;
}

function plannerCapabilities(registry) {
  return registry.map(item => ({
    id: item.id,
    label: item.label,
    pack: item.pack || "General",
    contractType: item.contractType || "contract-call",
    contract: item.contract,
    address: item.address,
    functionName: item.functionName,
    signature: item.signature,
    description: item.description,
    payable: Boolean(item.payable),
    macro: Boolean(item.expansion),
    inputs: item.inputs.map(input => ({
      name: input.name,
      type: input.type,
      semantic: input.semantic,
      required: input.default === undefined,
      default: input.default,
      protected: Boolean(input.protected)
    })),
    validation: item.validation || null,
    analysisHints: item.analysisHints || []
  }));
}

module.exports = {
  buildCapabilityRegistry,
  buildRegisteredCapabilities,
  normalizeCapability,
  findCapability,
  plannerCapabilities
};
