"use strict";

const assert = require("assert");
const hre = require("hardhat");

const { ethers } = hre;

describe("Treasury.batchTransferETH", function () {
  let deployer;
  let alice;
  let bob;
  let treasury;
  let rejectingRecipient;

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("Treasury", deployer);
    treasury = await Treasury.deploy(deployer.address);
    await treasury.deployed();

    // DAOSettings has no payable receive/fallback function. Sending ETH to it
    // therefore reverts and makes it useful for proving all-or-nothing behavior.
    const DAOSettings = await ethers.getContractFactory("DAOSettings", deployer);
    rejectingRecipient = await DAOSettings.deploy(deployer.address);
    await rejectingRecipient.deployed();

    await deployer.sendTransaction({
      to: treasury.address,
      value: ethers.utils.parseEther("5")
    });
  });

  it("executes a successful ETH batch in one Treasury transaction", async function () {
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const bobBefore = await ethers.provider.getBalance(bob.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    const amountA = ethers.utils.parseEther("1.25");
    const amountB = ethers.utils.parseEther("0.75");

    const tx = await treasury.batchTransferETH(
      [alice.address, bob.address],
      [amountA, amountB]
    );
    await tx.wait();

    const aliceAfter = await ethers.provider.getBalance(alice.address);
    const bobAfter = await ethers.provider.getBalance(bob.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);

    assert(aliceAfter.sub(aliceBefore).eq(amountA), "Alice did not receive 1.25 ETH");
    assert(bobAfter.sub(bobBefore).eq(amountB), "Bob did not receive 0.75 ETH");
    assert(treasuryBefore.sub(treasuryAfter).eq(amountA.add(amountB)), "Treasury balance changed by the wrong amount");
  });

  it("reverts the entire batch when any recipient rejects ETH", async function () {
    const amountA = ethers.utils.parseEther("1");
    const amountB = ethers.utils.parseEther("1");
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await assert.rejects(
      async () => {
        const tx = await treasury.batchTransferETH(
          [alice.address, rejectingRecipient.address],
          [amountA, amountB]
        );
        await tx.wait();
      },
      /ETH_TRANSFER_FAILED|reverted|cannot estimate gas/i
    );

    const aliceAfter = await ethers.provider.getBalance(alice.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);

    assert(aliceAfter.eq(aliceBefore), "Alice's earlier transfer was not rolled back");
    assert(treasuryAfter.eq(treasuryBefore), "Treasury balance changed despite batch revert");
  });

  it("rejects mismatched recipient and amount arrays", async function () {
    await assert.rejects(
      async () => {
        const tx = await treasury.batchTransferETH(
          [alice.address],
          [ethers.utils.parseEther("1"), ethers.utils.parseEther("2")]
        );
        await tx.wait();
      },
      /LENGTH_MISMATCH|reverted|cannot estimate gas/i
    );
  });

  it("rejects a batch whose aggregate amount exceeds Treasury balance", async function () {
    await assert.rejects(
      async () => {
        const tx = await treasury.batchTransferETH(
          [alice.address, bob.address],
          [ethers.utils.parseEther("3"), ethers.utils.parseEther("3")]
        );
        await tx.wait();
      },
      /INSUFFICIENT_ETH_BALANCE|reverted|cannot estimate gas/i
    );
  });
});
