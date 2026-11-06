const { ethers } = require("ethers");
const { findCapability } = require("./capabilityRegistry");
const { isAccessRole } = require("./semanticResolvers");

function arrayType(type) {
  const match = String(type || "").match(/^(.+)\[(\d*)\]$/);
  if (!match) return null;
  return {
    baseType: match[1],
    fixedLength: match[2] === "" ? null : Number(match[2])
  };
}

function isNumericType(type) {
  return /^(u?int)(\d+)?$/.test(String(type || ""));
}

function normalizeArguments(capability, supplied = {}) {
  const result = {};
  for (const input of capability.inputs || []) {
    if (Object.prototype.hasOwnProperty.call(supplied, input.name)) {
      result[input.name] = supplied[input.name];
    } else if (input.default !== undefined) {
      result[input.name] = input.default;
    }
  }
  return result;
}

function validateScalar(value, input, path) {
  const errors = [];
  const type = input.type;

  if (value === undefined || value === null || value === "") {
    errors.push(`${path} is required`);
    return errors;
  }

  const semantic = input.semantic || "";

  if (semantic === "access-role") {
    if (!isAccessRole(value)) {
      errors.push(`${path} must be a bytes32 role or a known role name such as PROPOSER_ROLE, EXECUTOR_ROLE, CANCELLER_ROLE or TIMELOCK_ADMIN_ROLE`);
    }
  } else if (type === "address" && !ethers.utils.isAddress(String(value))) {
    errors.push(`${path} must be a valid Ethereum address`);
  } else if (type === "bool" && typeof value !== "boolean") {
    errors.push(`${path} must be boolean`);
  } else if (type === "string" && typeof value !== "string") {
    errors.push(`${path} must be a string`);
  } else if (/^bytes(\d+)?$/.test(type)) {
    const text = String(value);
    if (!/^0x[a-fA-F0-9]*$/.test(text) || text.length % 2 !== 0) {
      errors.push(`${path} must be 0x-prefixed hexadecimal bytes`);
    }
    const fixed = type.match(/^bytes(\d+)$/)?.[1];
    if (fixed && text.length !== 2 + Number(fixed) * 2) {
      errors.push(`${path} must be exactly ${fixed} bytes`);
    }
  } else if (isNumericType(type)) {
    const decimalAllowed = ["token-amount", "token-amount-list", "ether-amount", "ether-amount-list"].includes(semantic);
    const regex = decimalAllowed ? /^\d+(?:\.\d+)?$/ : /^\d+$/;
    if (!regex.test(String(value))) {
      errors.push(`${path} must be ${decimalAllowed ? "a non-negative decimal" : "a non-negative integer"}`);
    }
  }

  return errors;
}

function validateValue(value, input, path) {
  const info = arrayType(input.type);
  if (!info) return validateScalar(value, input, path);

  if (!Array.isArray(value)) {
    return [`${path} must be an array`];
  }
  if (info.fixedLength !== null && value.length !== info.fixedLength) {
    return [`${path} must contain exactly ${info.fixedLength} elements`];
  }

  const scalarInput = { ...input, type: info.baseType };
  return value.flatMap((item, index) =>
    validateScalar(item, scalarInput, `${path}[${index}]`)
  );
}

function validateCapabilityRules(capability, args, index) {
  const errors = [];
  const rules = capability.validation || {};

  for (const pair of rules.equalLength || []) {
    const [left, right] = pair;
    if (Array.isArray(args[left]) && Array.isArray(args[right]) && args[left].length !== args[right].length) {
      errors.push(`operations[${index}] ${left} and ${right} must have equal length`);
    }
  }

  for (const [name, min] of Object.entries(rules.minArrayLength || {})) {
    if (Array.isArray(args[name]) && args[name].length < Number(min)) {
      errors.push(`operations[${index}].arguments.${name} must contain at least ${min} elements`);
    }
  }

  for (const [name, max] of Object.entries(rules.maxArrayLength || {})) {
    if (Array.isArray(args[name]) && args[name].length > Number(max)) {
      errors.push(`operations[${index}].arguments.${name} cannot exceed ${max} elements`);
    }
  }

  for (const [name, min] of Object.entries(rules.minValue || {})) {
    const value = args[name];
    if (value !== undefined && value !== null && /^\d+$/.test(String(value)) && BigInt(String(value)) < BigInt(String(min))) {
      errors.push(`operations[${index}].arguments.${name} must be at least ${min}`);
    }
  }

  for (const [name, max] of Object.entries(rules.maxValue || {})) {
    const value = args[name];
    if (value !== undefined && value !== null && /^\d+$/.test(String(value)) && BigInt(String(value)) > BigInt(String(max))) {
      errors.push(`operations[${index}].arguments.${name} cannot exceed ${max}`);
    }
  }

  return errors;
}

function validateProtectedValues(operation, capability, sourceText) {
  const errors = [];
  const source = String(sourceText || "").toLowerCase();

  for (const input of capability.inputs || []) {
    if (!input.protected) continue;
    const value = operation.arguments?.[input.name];
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (!source.includes(String(item).toLowerCase())) {
        errors.push(
          `Protected value operations.${operation.capabilityId}.${input.name} was not present verbatim in the source request`
        );
      }
    }
  }

  return errors;
}

function validatePlan({ plan, registry, sourceText = "", enforceProtected = true }) {
  const errors = [];
  if (!plan || typeof plan !== "object") {
    return { valid: false, errors: ["Plan is missing"] };
  }

  if (plan.status !== "ready") {
    errors.push(`Plan status is ${plan.status || "missing"}; executable plans require status=ready`);
  }

  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    errors.push("Plan must contain at least one operation");
  }

  for (const [index, operation] of (plan.operations || []).entries()) {
    const capability = findCapability(registry, operation.capabilityId);
    if (!capability) {
      errors.push(`operations[${index}] references unknown capability ${operation.capabilityId}`);
      continue;
    }

    const supplied = operation.arguments || {};
    const allowed = new Set((capability.inputs || []).map(input => input.name));
    for (const key of Object.keys(supplied)) {
      if (!allowed.has(key)) {
        errors.push(`operations[${index}].arguments.${key} is not defined by capability ${capability.id}`);
      }
    }

    const args = normalizeArguments(capability, supplied);
    for (const input of capability.inputs || []) {
      errors.push(...validateValue(args[input.name], input, `operations[${index}].arguments.${input.name}`));
    }

    errors.push(...validateCapabilityRules(capability, args, index));
    if (enforceProtected) {
      errors.push(...validateProtectedValues({ ...operation, arguments: args }, capability, sourceText));
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateGovernorProposalShape(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== "object") return { valid: false, errors: ["Proposal is missing"] };

  for (const field of ["targets", "values", "calldatas"]) {
    if (!Array.isArray(proposal[field])) errors.push(`${field} must be an array`);
  }

  if (
    Array.isArray(proposal.targets) &&
    Array.isArray(proposal.values) &&
    Array.isArray(proposal.calldatas) &&
    (proposal.targets.length !== proposal.values.length || proposal.targets.length !== proposal.calldatas.length)
  ) {
    errors.push("targets, values and calldatas must have identical lengths");
  }

  if (Array.isArray(proposal.targets) && proposal.targets.length === 0) {
    errors.push("Proposal must contain at least one action");
  }
  for (const [index, value] of (Array.isArray(proposal.values) ? proposal.values : []).entries()) {
    try {
      if (typeof value !== "string" && typeof value !== "number") throw new Error("invalid type");
      const parsed = ethers.BigNumber.from(value);
      if (parsed.lt(0) || parsed.gt(ethers.constants.MaxUint256)) throw new Error("out of range");
    } catch (_) { errors.push(`values[${index}] must be a non-negative uint256`); }
  }

  if (!String(proposal.description || "").trim()) errors.push("description is required");

  for (const [index, target] of (proposal.targets || []).entries()) {
    if (!ethers.utils.isAddress(String(target))) errors.push(`targets[${index}] is invalid`);
  }
  for (const [index, calldata] of (proposal.calldatas || []).entries()) {
    if (!/^0x[a-fA-F0-9]*$/.test(String(calldata)) || String(calldata).length % 2 !== 0) {
      errors.push(`calldatas[${index}] is invalid hex`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  normalizeArguments,
  validatePlan,
  validateGovernorProposalShape
};
