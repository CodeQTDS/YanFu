// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DAOSettings {
    address public timelock;
    uint256 public rewardRate;
    string public message;

    event RewardRateChanged(uint256 oldRate, uint256 newRate);
    event MessageChanged(string oldMessage, string newMessage);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "NOT_TIMELOCK");
        _;
    }

    constructor(address _timelock) {
        timelock = _timelock;
        rewardRate = 10;
        message = "Initial DAO message";
    }

    function setRewardRate(uint256 newRate) external onlyTimelock {
        uint256 oldRate = rewardRate;
        rewardRate = newRate;
        emit RewardRateChanged(oldRate, newRate);
    }

    function setMessage(string calldata newMessage) external onlyTimelock {
        string memory oldMessage = message;
        message = newMessage;
        emit MessageChanged(oldMessage, newMessage);
    }
}