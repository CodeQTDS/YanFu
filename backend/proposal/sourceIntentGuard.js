"use strict";

const { ethers } = require("ethers");
const { loadInputValidationConfig } = require("../config/configLoader");
const { extractFacts } = require("./factExtractor");
const { transferIntentFindings } = require("./intentAmounts");

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function cleanHex(value) {
  return String(value || "").trim();
}

function isAddressLiteral(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) && ethers.utils.isAddress(String(value));
}

function normalizeAddress(value) {
  if (!isAddressLiteral(value)) return null;
  return String(value).toLowerCase();
}

function buildConfiguredBindings(registry, config = loadInputValidationConfig()) {
  const byRef = new Map();

  for (const capability of registry || []) {
    const ref = capability.addressRef || capability.id?.split(".")[0] || capability.contract;
    if (!ref || !capability.address) continue;

    const existing = byRef.get(ref) || {
      addressRef: ref,
      address: capability.address,
      contract: capability.contract || ref,
      aliases: []
    };

    existing.aliases.push(capability.contract, ref, ...(capability.addressAliases || []));
    byRef.set(ref, existing);
  }

  for (const [ref, binding] of byRef.entries()) {
    binding.aliases.push(...(config.configuredAddressAliases?.[ref] || []));
    binding.aliases = [...new Set(binding.aliases.filter(Boolean).map(String))];
  }

  return [...byRef.values()];
}

function configuredBindingMentions(sourceText, registry, config = loadInputValidationConfig()) {
  const source = String(sourceText || "");
  const mentions = [];

  for (const binding of buildConfiguredBindings(registry, config)) {
    for (const alias of binding.aliases) {
      const escaped = escapeRegExp(alias);
      const patterns = [
        new RegExp(`\\b${escaped}\\b\\s*(?:contract\\s*)?(?:at|address\\s*(?:is|=|:)?|=|:)\\s*(0x[a-fA-F0-9]+)`, "gi"),
        new RegExp(`\\b(?:address\\s*)?(0x[a-fA-F0-9]+)\\s*(?:for|of)\\s*${escaped}\\b`, "gi")
      ];

      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          mentions.push({
            addressRef: binding.addressRef,
            contract: binding.contract,
            expected: binding.address,
            alias,
            provided: cleanHex(match[1]),
            matchedText: match[0],
            index: match.index ?? -1
          });
        }
      }
    }
  }

  return uniqueBy(mentions, item => `${item.addressRef}|${item.provided.toLowerCase()}|${item.index}`);
}

function genericAddressMentions(sourceText, config = loadInputValidationConfig()) {
  const source = String(sourceText || "");
  const mentions = [];
  const keywords = config.genericAddressKeywords || ["address", "recipient", "spender"];
  const keywordPattern = keywords.map(escapeRegExp).join("|");

  if (keywordPattern) {
    const pattern = new RegExp(`\\b(?:${keywordPattern})\\b\\s*(?:(?:is|=|:)\\s*)?(?:(?:exactly|the|recipient|address|wallet|account)\\s+){0,3}(0x[a-zA-Z0-9]+)\\b`, "gi");
    for (const match of source.matchAll(pattern)) {
      mentions.push({ provided: cleanHex(match[1]), matchedText: match[0], index: match.index ?? -1 });
    }
  }

  // Common transfer language can contain a recipient without the word "address".
  const recipientPattern = /\b(?:send|transfer|pay)\b(?:(?!\.\s)[^;\n]){0,120}?\bto\s+(?:(?:exactly|the|recipient|address|wallet|account)\s+){0,3}(0x[a-zA-Z0-9]+)\b/gi;
  for (const match of source.matchAll(recipientPattern)) {
    mentions.push({ provided: cleanHex(match[1]), matchedText: match[0], index: match.index ?? -1 });
  }

  return uniqueBy(mentions, item => `${item.provided.toLowerCase()}|${item.index}`);
}

function validateSourceIntent({ sourceText, registry, config = loadInputValidationConfig() }) {
  const source = String(sourceText || "").trim();
  const facts = extractFacts(source);
  const errors = [];
  const warnings = [];
  const configuredMentions = configuredBindingMentions(source, registry, config);

  if (config.enabled === false) {
    return { valid: true, errors, warnings, facts, configuredMentions, skipped: true };
  }

  if (config.rejectConfiguredAddressConflicts !== false) {
    for (const mention of configuredMentions) {
      if (!isAddressLiteral(mention.provided)) {
        errors.push({
          code: "MALFORMED_CONFIGURED_ADDRESS",
          field: mention.addressRef,
          provided: mention.provided,
          expected: mention.expected,
          message: `${mention.contract} was explicitly bound to ${mention.provided}, but that is not a valid Ethereum address. Omit the address to use configured ${mention.expected}, or provide that configured address explicitly.`
        });
        continue;
      }

      if (normalizeAddress(mention.provided) !== normalizeAddress(mention.expected)) {
        errors.push({
          code: "CONFIGURED_ADDRESS_CONFLICT",
          field: mention.addressRef,
          provided: mention.provided,
          expected: mention.expected,
          message: `${mention.contract} was explicitly bound to ${mention.provided}, but YanFu is configured to use ${mention.expected}. Explicit user input cannot be silently replaced by configuration.`
        });
      }
    }
  }

  if (config.rejectMalformedAddressLiterals !== false) {
    const boundIndexes = new Set(configuredMentions.map(item => `${item.provided.toLowerCase()}|${item.index}`));
    for (const mention of genericAddressMentions(source, config)) {
      // Configured-binding errors above provide a more specific message.
      if ([...boundIndexes].some(key => key.startsWith(`${mention.provided.toLowerCase()}|`))) continue;
      if (!isAddressLiteral(mention.provided)) {
        errors.push({
          code: "MALFORMED_EXPLICIT_ADDRESS",
          field: "address",
          provided: mention.provided,
          expected: null,
          message: `The request explicitly contains ${mention.provided} in an address-like position, but it is not a valid 20-byte Ethereum address.`
        });
      }
    }
  }

  const dedupedErrors = uniqueBy(errors, item => `${item.code}|${item.field}|${String(item.provided).toLowerCase()}|${item.expected || ""}`);

  return {
    valid: dedupedErrors.length === 0,
    errors: dedupedErrors,
    warnings,
    facts,
    configuredMentions
  };
}

function flattenExecutableStrings(value, output = []) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach(item => flattenExecutableStrings(item, output));
    return output;
  }
  if (typeof value === "object") {
    Object.values(value).forEach(item => flattenExecutableStrings(item, output));
    return output;
  }
  if (["string", "number", "bigint", "boolean"].includes(typeof value)) {
    output.push(String(value).toLowerCase());
  }
  return output;
}

function sourceIntentConsistencyReview({ proposal, registry, config = loadInputValidationConfig() }) {
  const sourceText = proposal?.sourceText || proposal?.metadata?.sourceText || proposal?.description || "";
  const preflight = validateSourceIntent({ sourceText, registry, config });
  const findings = preflight.errors.map(error => ({
    source: "source-intent",
    severity: "HIGH",
    category: "source-input-conflict",
    message: error.message,
    suggestion: "Correct the natural-language request and compile it again instead of silently substituting configured values."
  }));

  if (config.reviewExplicitSourceLiterals !== false) {
    const facts = extractFacts(sourceText);
    const executableValues = flattenExecutableStrings({
      targets: proposal?.targets || [],
      actions: (proposal?.actions || []).map(action => ({
        target: action.target,
        arguments: action.arguments,
        encodedArguments: action.encodedArguments
      })),
      operations: proposal?.plan?.operations || []
    });
    const executableText = executableValues.join("\n");

    for (const address of facts.addresses || []) {
      if (!executableText.includes(address.toLowerCase())) {
        findings.push({
          source: "source-intent",
          severity: "HIGH",
          category: "explicit-address-omitted",
          message: `Explicit source address ${address} is not represented in the semantic or executable proposal.`,
          suggestion: "Compare the source request with action targets/arguments and recompile if the explicit address was omitted or replaced."
        });
      }
    }

    for (const literal of [...(facts.bytes32 || []), ...(facts.hexBlobs || [])]) {
      if (!executableText.includes(String(literal).toLowerCase())) {
        findings.push({
          source: "source-intent",
          severity: "HIGH",
          category: "protected-literal-omitted",
          message: `Explicit protected hexadecimal literal ${String(literal).slice(0, 18)}… is not represented in the executable proposal.`,
          suggestion: "Preserve explicit salts/bytecode exactly or ask the user to clarify the request."
        });
      }
    }
  }

  findings.push(...transferIntentFindings({ sourceText, proposal }));
  const deduped = uniqueBy(findings, item => `${item.category}|${item.message}`);
  return {
    passed: !deduped.some(item => ["HIGH", "CRITICAL"].includes(String(item.severity).toUpperCase())),
    findings: deduped,
    preflight
  };
}

module.exports = {
  isAddressLiteral,
  buildConfiguredBindings,
  configuredBindingMentions,
  genericAddressMentions,
  validateSourceIntent,
  sourceIntentConsistencyReview
};
