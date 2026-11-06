"use strict";

// Read the executable payload, not human-edit lineage or stale semantic actions.
// Decoding is evidence only: the Governor targets/values/calldatas remain authoritative.
const { ethers } = require("ethers");
const { buildCapabilityRegistry } = require("../proposal/capabilityRegistry");

function serializeEthers(value) {
  if (Array.isArray(value)) return value.map(serializeEthers);
  if (value && typeof value === "object" && value._isBigNumber) return value.toString();
  if (value && typeof value === "object" && typeof value.toHexString === "function") return value.toString();
  return value;
}

function humanUnits(value, input) {
  const val = serializeEthers(value);
  const semantic = input?.semantic || "";
  const decimals = input?.decimals ?? 18;
  if (semantic === "token-amount") return ethers.utils.formatUnits(val, decimals);
  if (semantic === "ether-amount") return ethers.utils.formatEther(val);
  if (semantic === "token-amount-list") return val.map(v => ethers.utils.formatUnits(v, decimals));
  if (semantic === "ether-amount-list") return val.map(v => ethers.utils.formatEther(v));
  return val;
}

function decodeExecutableProposal(proposal, registry = buildCapabilityRegistry()) {
  const results = [];
  for (let index = 0; index < (proposal?.targets || []).length; index++) {
    const target = String(proposal.targets[index] || "");
    const calldata = String(proposal.calldatas?.[index] || "");
    const value = String(proposal.values?.[index] ?? "0");
    const result = {
      index,
      target,
      value,
      calldataSelector: calldata.slice(0, 10),
      calldataBytes: calldata.startsWith("0x") ? Math.max(0, (calldata.length - 2) / 2) : 0,
      decoded: false,
      decodingNote: "Not matched to a configured capability; no semantic claims made. Verify exact calldata independently."
    };
    for (const capability of registry) {
      if (!capability?.abi || String(capability.address || "").toLowerCase() !== target.toLowerCase()) continue;
      try {
        const iface = new ethers.utils.Interface([capability.abi]);
        const parsed = iface.parseTransaction({ data: calldata });
        if (parsed.signature !== (capability.signature || parsed.signature)) continue;
        const encodedArguments = (capability.inputs || []).map((_, i) => serializeEthers(parsed.args[i]));
        const humanArguments = {};
        (capability.inputs || []).forEach((input, i) => {
          humanArguments[input.name] = humanUnits(parsed.args[i], input);
        });
        Object.assign(result, {
          decoded: true,
          decodingNote: "Decoded from exact Governor calldata using registered capability ABI",
          capabilityId: capability.id,
          pack: capability.pack || "General",
          functionName: capability.functionName,
          functionSignature: parsed.signature,
          arguments: humanArguments,
          encodedArguments
        });
        break;
      } catch (_) { /* Try other registered signatures; never guess. */ }
    }
    results.push(result);
  }
  return results;
}

module.exports = { decodeExecutableProposal, serializeEthers, humanUnits };
