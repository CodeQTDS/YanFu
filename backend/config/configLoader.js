const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function readJson(relativePath) {
  const fullPath = path.resolve(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function loadAppConfig() {
  return readJson("config/app.config.json");
}

function loadChainConfig() {
  return readJson("config/chain.config.json");
}

function loadModelsConfig() {
  return readJson("config/models.config.json");
}

function loadProposalElements() {
  return readJson("config/proposal-elements.json");
}

function loadInputValidationConfig() {
  return readJson("config/input-validation.json");
}

function loadReviewPolicy() {
  return readJson("config/review-policy.json");
}

function loadReviewersConfig() {
  return readJson("config/reviewers.config.json");
}

function loadContractTypeTemplates() {
  return readJson("config/contract-type-templates.json");
}

function loadRegisteredContracts() {
  return readJson("config/registered-contracts.json");
}

function loadPromptTemplates() {
  return readJson("config/prompt-templates.json");
}

function loadUiConfig() {
  return readJson("config/ui.config.json");
}

module.exports = {
  ROOT,
  readJson,
  loadAppConfig,
  loadChainConfig,
  loadModelsConfig,
  loadProposalElements,
  loadInputValidationConfig,
  loadReviewPolicy,
  loadReviewersConfig,
  loadContractTypeTemplates,
  loadRegisteredContracts,
  loadPromptTemplates,
  loadUiConfig
};
