// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


contract DAOContractFactory {

    address public immutable timelock;


    event ContractDeployed(
        address indexed deployedContract,
        bytes32 indexed salt
    );


    modifier onlyTimelock() {
        require(
            msg.sender == timelock,
            "ONLY_TIMELOCK"
        );
        _;
    }


    constructor(address _timelock) {

        require(
            _timelock != address(0),
            "INVALID_TIMELOCK"
        );

        timelock = _timelock;
    }


    /**
     * @notice Deploy arbitrary contract
     *
     * @param bytecode Contract creation bytecode
     * @param salt CREATE2 salt
     *
     * @return deployedAddress New contract address
     */
    function deployContract(
        bytes memory bytecode,
        bytes32 salt
    )
        external
        onlyTimelock
        returns(address deployedAddress)
    {

        require(
            bytecode.length > 0,
            "EMPTY_BYTECODE"
        );


        assembly {

            deployedAddress :=
                create2(
                    0,
                    add(bytecode, 0x20),
                    mload(bytecode),
                    salt
                )

            if iszero(extcodesize(deployedAddress)) {
                revert(0,0)
            }
        }


        emit ContractDeployed(
            deployedAddress,
            salt
        );
    }
}