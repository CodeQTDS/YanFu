// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";


contract MyToken is ERC20, ERC20Permit, ERC20Votes {

    constructor()
        ERC20("MyToken", "MTK")
        ERC20Permit("MyToken")
    {
        _mint(msg.sender, 1_000_000 ether);
    }


    /*
        OZ v4 ERC20Votes requires overriding
        _afterTokenTransfer()
    */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    )
        internal
        override(ERC20, ERC20Votes)
    {
        super._afterTokenTransfer(
            from,
            to,
            amount
        );
    }


    /*
        OZ v4 ERC20Votes requires overriding _mint()
    */
    function _mint(
        address account,
        uint256 amount
    )
        internal
        override(ERC20, ERC20Votes)
    {
        super._mint(account, amount);
    }


    /*
        OZ v4 ERC20Votes requires overriding _burn()
    */
    function _burn(
        address account,
        uint256 amount
    )
        internal
        override(ERC20, ERC20Votes)
    {
        super._burn(account, amount);
    }


    /*
        Resolve ERC20Permit nonce conflict
    */
    function nonces(address owner)
        public
        view
        override(ERC20Permit)
        returns(uint256)
    {
        return super.nonces(owner);
    }
}