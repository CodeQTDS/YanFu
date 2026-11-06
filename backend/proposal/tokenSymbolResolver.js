"use strict";

// Strictly scoped semantic normalization. The selected token is the token
// address obtained from the trusted chain configuration, never an AI guess.
const SUPPORTED = new Set(["treasury.transferERC20", "treasury.batchTransferERC20"]);

function exactWordPresent(text, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "i").test(String(text || ""));
}

function resolveConfiguredTokenSymbol({ plan, chainContext, registry, sourceText }) {
  const symbol = chainContext?.token?.symbol;
  const tokenAddress = chainContext?.addresses?.token;
  const fixedAddress = (registry || []).find(item => item.id === "treasury.transferERC20")
    ?.inputs?.find(item => item.name === "token")?.default;
  if (typeof symbol !== "string" || !symbol.trim() ||
      typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress) ||
      typeof fixedAddress !== "string" || fixedAddress.toLowerCase() !== tokenAddress.toLowerCase() ||
      !exactWordPresent(sourceText, symbol)) return 0;

  let resolved = 0;
  for (const operation of plan?.operations || []) {
    if (!SUPPORTED.has(operation?.capabilityId)) continue;
    const registered = (registry || []).find(item => item.id === operation.capabilityId);
    if (!registered?.inputs?.some(input => input.name === "token" &&
        String(input.default || "").toLowerCase() === tokenAddress.toLowerCase())) continue;
    const args = operation?.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    if (typeof args.token === "string" && args.token.trim().toLowerCase() === symbol.trim().toLowerCase()) {
      args.token = tokenAddress;
      resolved += 1;
    }
  }
  return resolved;
}

module.exports = { resolveConfiguredTokenSymbol, exactWordPresent };
