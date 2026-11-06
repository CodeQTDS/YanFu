"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildCapabilityRegistry
} = require("../backend/proposal/capabilityRegistry");
const { validatePlan } = require("../backend/proposal/validator");
const { buildGovernorProposal } = require("../backend/proposal/encoder");
const {
  loadChainConfig,
  loadProposalElements,
  loadContractTypeTemplates
} = require("../backend/config/configLoader");

const ROOT = path.resolve(__dirname, "..");
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "test/capability-cases.json"), "utf8")).cases;

const fixtureContracts = {
  protocolController: {
    id: "protocolController",
    label: "Protocol Controller",
    enabled: true,
    address: "0x1234567890123456789012345678901234567890",
    aliases: ["protocol controller"],
    capabilities: [
      { id: "protocol.pause", templateId: "administration.pause" },
      { id: "protocol.unpause", templateId: "administration.unpause" },
      { id: "protocol.transferOwnership", templateId: "administration.transferOwnership" },
      { id: "protocol.upgrade", templateId: "upgrade.uupsUpgradeToAndCall" }
    ]
  },
  nftCollection: {
    id: "nftCollection",
    label: "NFT Collection",
    enabled: true,
    address: "0x2345678901234567890123456789012345678901",
    aliases: ["NFT contract"],
    capabilities: [
      { id: "nft.transfer721", templateId: "nft.erc721SafeTransferFrom" }
    ]
  },
  dexRouter: {
    id: "dexRouter",
    label: "DEX Router",
    enabled: true,
    address: "0x3456789012345678901234567890123456789012",
    aliases: ["DEX router"],
    capabilities: [
      {
        id: "defi.swapExactTokensForTokens",
        pack: "DeFi Pack",
        contractType: "dex-router",
        label: "Swap Exact Tokens For Tokens",
        functionName: "swapExactTokensForTokens",
        signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
        abi: "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns(uint256[] amounts)",
        description: "Test-only registered DEX capability.",
        payable: false,
        inputs: [
          { name: "amountIn", type: "uint256", semantic: "token-base-units" },
          { name: "amountOutMin", type: "uint256", semantic: "token-base-units" },
          { name: "path", type: "address[]", semantic: "address-list" },
          { name: "to", type: "address", semantic: "recipient" },
          { name: "deadline", type: "uint256", semantic: "timestamp" }
        ],
        riskProfile: { flatWeight: 55, category: "defi-swap" }
      }
    ]
  }
};

function registryFor(testCase) {
  const contract = testCase.registrationFixture ? fixtureContracts[testCase.registrationFixture] : null;
  return buildCapabilityRegistry({
    chainConfig: loadChainConfig(),
    proposalElements: loadProposalElements(),
    contractTypeTemplates: loadContractTypeTemplates(),
    registeredContracts: {
      version: 1,
      contracts: contract ? [contract] : []
    }
  });
}

let failed = 0;
for (const testCase of cases) {
  try {
    const registry = registryFor(testCase);
    const validation = validatePlan({
      plan: testCase.plan,
      registry,
      sourceText: testCase.text,
      enforceProtected: false
    });
    if (!validation.valid) throw new Error(validation.errors.join("; "));

    const proposal = buildGovernorProposal({
      plan: testCase.plan,
      registry,
      description: testCase.plan.description,
      metadata: { testCase: testCase.id }
    });

    const semanticIds = testCase.plan.operations.map(item => item.capabilityId);
    for (const expected of testCase.expectedCapabilities || []) {
      if (!semanticIds.includes(expected)) throw new Error(`expected semantic capability ${expected}`);
    }
    if (testCase.expectedExecutableActions !== undefined && proposal.actions.length !== testCase.expectedExecutableActions) {
      throw new Error(`expected ${testCase.expectedExecutableActions} executable actions, got ${proposal.actions.length}`);
    }
    if (testCase.expectedFunctionName && proposal.actions[0]?.functionName !== testCase.expectedFunctionName) {
      throw new Error(`expected function ${testCase.expectedFunctionName}, got ${proposal.actions[0]?.functionName}`);
    }
    if (testCase.expectedEncodedAmountsWei) {
      const actual = proposal.actions[0]?.encodedArguments?.[1] || [];
      if (JSON.stringify(actual) !== JSON.stringify(testCase.expectedEncodedAmountsWei)) {
        throw new Error(`unexpected encoded batch ETH amounts: ${JSON.stringify(actual)}`);
      }
    }
    if (!proposal.actions.length || proposal.targets.length !== proposal.actions.length || proposal.calldatas.length !== proposal.actions.length) {
      throw new Error("encoded proposal arrays are inconsistent");
    }

    console.log(`PASS ${testCase.id} -> ${proposal.actions.map(a => a.capabilityId).join(", ")}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.id}: ${error.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} v1.0 capability test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS all ${cases.length} v1.0 capability tests.`);
}
