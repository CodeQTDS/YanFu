# Optional capabilities · v1.0

The standard path needs no custom contracts. Built-in capability IDs are preserved:

| Area | Capability IDs |
|---|---|
| Treasury | `treasury.transferERC20`, `treasury.batchTransferERC20`, `treasury.transferETH`, `treasury.batchTransferETH` |
| Token | `token.approve` |
| Settings | `daoSettings.setRewardRate`, `daoSettings.setMessage` |
| Factory | `factory.deployContract` |
| Governor | `governor.setVotingDelay`, `governor.setVotingPeriod`, `governor.setProposalThreshold`, `governor.updateQuorumNumerator` |
| Timelock | `timelock.updateDelay`, `timelock.grantRole`, `timelock.revokeRole` |

These describe what can be encoded, not a guarantee of permission or future execution. For example, token.approve runs from the actual executing contract; it is not a wallet approval on behalf of another account. The bundled Treasury implements ETH/ERC20 transfers; NFT and protocol-specific actions require separately registered appropriate contracts.

## Register a contract

1. Deploy a known contract on the disposable chain and verify its ABI and permissions.
2. Open the ignored `config/registered-contracts.json` created by setup.
3. Copy an appropriate disabled entry from `registered-contracts.catalog.example.json`.
4. Replace the example address, select compatible template IDs or provide the exact inline ABI, then set `enabled: true` only for the intended entry.
5. Restart backend, run `npm run check` and `npm run test:capabilities`, then inspect generated calldata and real execution in your fixture.

Example structure (replace the address locally before enabling):

```json
{
  "version": 1,
  "contracts": [
    {
      "id": "myController",
      "label": "My Local Controller",
      "enabled": false,
      "address": "0x1111111111111111111111111111111111111111",
      "aliases": ["my controller"],
      "capabilities": [
        {"id": "controller.pause", "templateId": "administration.pause"}
      ]
    }
  ]
}
```

Templates include ownership/access control, pausing, upgrades, NFTs and protocol-specific patterns. A matching function name is not proof that a contract has the expected semantics. DeFi, upgrades and creation bytecode need additional verification. Do not enable optional AI test cases until their exact deployed fixtures exist.

The factory can deploy supplied creation bytecode through CREATE2 under Timelock control. It is not an AI-generated-bytecode safety guarantee. Source-intent protected literals and all normal review/confirmation gates still apply.
