"use strict";
const assert = require("assert");
const { ethers } = require("hardhat");
async function reverts(promise, reason) {
  let error;
  try { await promise; } catch (e) {error=e;}
  assert(error, "Expected a revert");
  assert(String(error.message).includes(reason), `Expected ${reason}, got ${error.message}`);
}
describe("Treasury token contract code guard", function () {
  it("rejects no-code token address in single and batch ERC20", async function () {
    const [timelock, recipient, noCode] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(timelock.address);
    await treasury.deployed();
    await reverts(treasury.transferERC20(noCode.address,recipient.address,10),"TOKEN_NOT_CONTRACT");
    await reverts(treasury.batchTransferERC20(noCode.address,[recipient.address],[10]),"TOKEN_NOT_CONTRACT");
    await reverts(treasury.transferERC20(ethers.constants.AddressZero,recipient.address,10),"TOKEN_NOT_CONTRACT");
  });
  it("preserves legitimate single and batch ERC20 transfer behavior", async function () {
    const [timelock, first, second] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(timelock.address);
    await treasury.deployed();
    const Token = await ethers.getContractFactory("MyToken");
    const token = await Token.deploy();
    await token.deployed();
    await (await token.transfer(treasury.address, 100)).wait();
    await (await treasury.transferERC20(token.address, first.address, 10)).wait();
    await (await treasury.batchTransferERC20(token.address, [first.address, second.address], [20, 30])).wait();
    assert.equal((await token.balanceOf(first.address)).toString(), "30");
    assert.equal((await token.balanceOf(second.address)).toString(), "30");
    assert.equal((await token.balanceOf(treasury.address)).toString(), "40");
  });
});
