const express = require("express");
const {
  loadAppConfig,
  loadChainConfig,
  loadProposalElements,
  loadInputValidationConfig,
  loadReviewPolicy,
  loadReviewersConfig,
  loadContractTypeTemplates,
  loadRegisteredContracts,
  loadUiConfig
} = require("../config/configLoader");
const { getChainContext } = require("../chain/context");

const router = express.Router();

router.get("/public", (req, res) => {
  const app = loadAppConfig();
  const chain = loadChainConfig();
  const proposalElements = loadProposalElements();
  const reviewPolicy = loadReviewPolicy();
  const inputValidation = loadInputValidationConfig();
  const reviewers = loadReviewersConfig();
  const contractTypeTemplates = loadContractTypeTemplates();
  const registeredContracts = loadRegisteredContracts();
  const ui = loadUiConfig();

  res.json({
    success: true,
    app,
    chain,
    proposalElements: {
      version: proposalElements.version,
      capabilities: proposalElements.capabilities.map(item => ({
        id: item.id,
        label: item.label,
        pack: item.pack || "General",
        contractType: item.contractType || "contract-call",
        description: item.description
      }))
    },
    reviewPolicy: {
      version: reviewPolicy.version,
      verdicts: reviewPolicy.verdicts,
      severityLevels: reviewPolicy.severityLevels
    },
    reviewers: {
      version: reviewers.version,
      limits: reviewers.limits,
      profiles: reviewers.profiles,
      profileDefaults: reviewers.profileDefaults || [],
      consensus: reviewers.consensus,
      loopCompatibility: reviewers.loopCompatibility
    },
    contractTypes: {
      templateVersion: contractTypeTemplates.version,
      templates: (contractTypeTemplates.templates || []).map(item => ({
        templateId: item.templateId,
        label: item.label,
        pack: item.pack,
        contractType: item.contractType,
        description: item.description
      })),
      registeredContractsVersion: registeredContracts.version,
      activeRegisteredContracts: (registeredContracts.contracts || []).filter(item => item.enabled === true).map(item => ({
        id: item.id,
        label: item.label || item.id,
        capabilityCount: (item.capabilities || []).filter(cap => cap.enabled !== false).length
      }))
    },
    inputValidation: {
      version: inputValidation.version,
      enabled: inputValidation.enabled !== false,
      rejectMalformedAddressLiterals: inputValidation.rejectMalformedAddressLiterals !== false,
      rejectConfiguredAddressConflicts: inputValidation.rejectConfiguredAddressConflicts !== false
    },
    ui
  });
});

router.get("/chain-context", async (req, res) => {
  try {
    res.json({ success: true, context: await getChainContext() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
