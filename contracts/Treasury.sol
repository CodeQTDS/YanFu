// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract Treasury {

    address public timelock;

    /*
     * Safety guard against an accidentally enormous
     * governance batch that cannot fit in block gas.
     *
     * You can adjust this later.
     */
    uint256 public constant MAX_BATCH_SIZE = 50;

    constructor(address _timelock) {
        timelock = _timelock;
    }

    modifier onlyTimelock() {
        require(
            msg.sender == timelock,
            "NOT TIMELOCK"
        );
        _;
    }

    receive() external payable {}


    /*
    ====================================================
     SINGLE ERC20 TRANSFER
    ====================================================
    */

    function transferERC20(
        address token,
        address to,
        uint256 amount
    )
        external
        onlyTimelock
    {
        require(token != address(0) && token.code.length > 0, "TOKEN_NOT_CONTRACT");
        (bool ok, bytes memory data) =
            token.call(
                abi.encodeWithSignature(
                    "transfer(address,uint256)",
                    to,
                    amount
                )
            );

        require(
            ok
            &&
            (
                data.length == 0
                ||
                abi.decode(
                    data,
                    (bool)
                )
            ),
            "ERC20_TRANSFER_FAILED"
        );
    }


    /*
    ====================================================
     BATCH ERC20 TRANSFER
    ====================================================
    */

    function batchTransferERC20(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    )
        external
        onlyTimelock
    {
        uint256 length =
            recipients.length;

        require(
            length > 0,
            "EMPTY_BATCH"
        );
        require(token != address(0) && token.code.length > 0, "TOKEN_NOT_CONTRACT");

        require(
            length == amounts.length,
            "LENGTH_MISMATCH"
        );

        require(
            length <= MAX_BATCH_SIZE,
            "BATCH_TOO_LARGE"
        );


        for (
            uint256 i = 0;
            i < length;
            i++
        ) {

            (bool ok, bytes memory data) =
                token.call(
                    abi.encodeWithSignature(
                        "transfer(address,uint256)",
                        recipients[i],
                        amounts[i]
                    )
                );


            require(
                ok
                &&
                (
                    data.length == 0
                    ||
                    abi.decode(
                        data,
                        (bool)
                    )
                ),
                "ERC20_TRANSFER_FAILED"
            );
        }
    }


    /*
    ====================================================
     ETH TRANSFER
    ====================================================
    */

    function transferETH(
        address payable to,
        uint256 amount
    )
        external
        onlyTimelock
    {
        (bool ok,) =
            to.call{
                value: amount
            }("");

        require(
            ok,
            "ETH_TRANSFER_FAILED"
        );
    }


    /*
    ====================================================
     BATCH ETH TRANSFER (ATOMIC)
    ====================================================
    */

    function batchTransferETH(
        address payable[] calldata recipients,
        uint256[] calldata amounts
    )
        external
        onlyTimelock
    {
        uint256 length = recipients.length;

        require(
            length > 0,
            "EMPTY_BATCH"
        );

        require(
            length == amounts.length,
            "LENGTH_MISMATCH"
        );

        require(
            length <= MAX_BATCH_SIZE,
            "BATCH_TOO_LARGE"
        );

        uint256 totalAmount;
        for (uint256 i = 0; i < length; i++) {
            totalAmount += amounts[i];
        }

        require(
            totalAmount <= address(this).balance,
            "INSUFFICIENT_ETH_BALANCE"
        );

        for (uint256 i = 0; i < length; i++) {
            (bool ok,) = recipients[i].call{
                value: amounts[i]
            }("");

            require(
                ok,
                "ETH_TRANSFER_FAILED"
            );
        }
    }


    function setTimelock(
        address newTimelock
    )
        external
        onlyTimelock
    {
        require(
            newTimelock !=
            address(0),
            "ZERO_TIMELOCK"
        );

        timelock =
            newTimelock;
    }
}