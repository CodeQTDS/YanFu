"use strict";

const GOVERNOR_ABI = [
  "function propose(address[] targets,uint256[] values,bytes[] calldatas,string description) returns(uint256)",
  "function hashProposal(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) view returns(uint256)"
];

async function connect() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another EIP-1193 wallet is required");
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();

  return { provider, signer, address, network };
}

async function submitProposal(proposal, chainConfig) {
  const { signer, address, network } = await connect();

  if (Number(network.chainId) !== Number(chainConfig.chainId)) {
    throw new Error(`Wallet is on chain ${network.chainId}; expected chain ${chainConfig.chainId}`);
  }

  const governor = new ethers.Contract(chainConfig.governor, GOVERNOR_ABI, signer);
  const descriptionHash = ethers.utils.id(proposal.description);
  const predictedProposalId = await governor.hashProposal(
    proposal.targets,
    proposal.values,
    proposal.calldatas,
    descriptionHash
  );

  const tx = await governor.propose(
    proposal.targets,
    proposal.values,
    proposal.calldatas,
    proposal.description
  );
  const receipt = await tx.wait();

  return {
    actor: address,
    chainId: Number(network.chainId),
    proposalId: predictedProposalId.toString(),
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber
  };
}

window.DAO_WALLET = {
  connect,
  submitProposal
};
