"use strict";

function setStatus(id, message, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status ${type}`.trim();
  el.textContent = message;
}

function showJson(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ? JSON.stringify(value, null, 2) : "No data yet.";
}

function severityBadge(value) {
  const normalized = String(value || "").toUpperCase();
  const cls = ["HIGH", "CRITICAL", "REJECT"].includes(normalized)
    ? "bad"
    : ["MEDIUM", "NEEDS_CHANGES"].includes(normalized)
      ? "warn"
      : "good";
  return `<span class="badge ${cls}">${normalized || "UNKNOWN"}</span>`;
}

async function refreshChainSummary() {
  const target = document.getElementById("chainSummary");
  if (!target) return null;
  try {
    const response = await DAO_API.get("/api/config/chain-context");
    const context = response.context;
    target.textContent = `Chain ${context.chainId} · Block ${context.blockNumber} · Treasury ${context.addresses.treasury.slice(0, 8)}…`;
    return context;
  } catch (error) {
    target.textContent = `Chain unavailable: ${error.message}`;
    return null;
  }
}

window.DAO_UI = {
  setStatus,
  showJson,
  severityBadge,
  refreshChainSummary
};
