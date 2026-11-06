const { ethers } = require("ethers");

const ACCESS_ROLE_ALIASES = Object.freeze({
  PROPOSER_ROLE: ethers.utils.id("PROPOSER_ROLE"),
  EXECUTOR_ROLE: ethers.utils.id("EXECUTOR_ROLE"),
  CANCELLER_ROLE: ethers.utils.id("CANCELLER_ROLE"),
  TIMELOCK_ADMIN_ROLE: ethers.utils.id("TIMELOCK_ADMIN_ROLE"),
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero
});

function resolveAccessRole(value) {
  const raw = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw;

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return ACCESS_ROLE_ALIASES[key] || null;
}

function isAccessRole(value) {
  return Boolean(resolveAccessRole(value));
}

module.exports = {
  ACCESS_ROLE_ALIASES,
  resolveAccessRole,
  isAccessRole
};
