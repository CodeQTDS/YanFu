"use strict";
// Regression for missed explicit invalid address following "to exactly".
// Uses the production source-intent guard and isolates its regex detection
// from the ethers package. Mocked ethers.isAddress is not a full EVM test.
const assert = require("assert");
const path = require("path");
const Module = require("module");
const original = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === "ethers") return { ethers: { utils: {
    isAddress: value => /^0x[a-fA-F0-9]{40}$/.test(String(value))
  } } };
  return original.apply(this, arguments);
};
const { validateSourceIntent } = require(path.join(__dirname, "..", "backend", "proposal", "sourceIntentGuard"));
Module._load = original;
const config = require(path.join(__dirname,"..", "config", "input-validation.json"));
let checks = 0;
function runCase(sourceText, accepted, label) {
  const result = validateSourceIntent({sourceText, registry: [], config });
  assert.strictEqual(result.valid, accepted, `${label}: ${JSON.stringify(result.errors)}`);
  if (!accepted) assert(result.errors.some(e => e.code === "MALFORMED_EXPLICIT_ADDRESS"), label);
  checks++;
}
const valid="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const invalid=["0x123","0xabc","0x123GHI","0xZZZZ"];
const forms=[
 "Transfer 6 MTK from the DAO Treasury to exactly {a}; do not choose or replace the recipient.",
 "Transfer 0.04 ETH from the DAO Treasury to exactly {a}; do not substitute a different address.",
 "Send 1 ETH to {a}.",
 "Pay 2 MTK to the address {a}.",
 "Transfer 7 MTK to the recipient address {a}.",
 "Recipient is exactly {a}.",
 "Recipient address {a} receives 1 MTK.",
 "The spender address is {a}.",
 "Transfer 0.1 ETH to the wallet account {a}."
];
for (const f of forms) {
 for (const a of invalid) runCase(f.replace('{a}',a),false, `reject ${a}: ${f}`);
 runCase(f.replace('{a}',valid),true, `accept ${valid}: ${f}`);
}
runCase("Update the voting period to 7200 blocks.",true,"unrelated governance input");
runCase("This contains text 0x123 in a plain description, not a transfer.",true,"unrelated literal");
// Must not silently auto-correct a malformed literal to another valid recipient.
runCase("Transfer 1 MTK from Treasury to exactly 0x123, and send 1 MTK to "+valid,false,"mixed invalid+valid recipient");
console.log(`PASS v1.0 source address preflight: ${checks} offline tests`);
