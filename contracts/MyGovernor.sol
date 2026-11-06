// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";


contract MyGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{

    constructor(
        IVotes token,
        TimelockController timelock
    )
        Governor("MyGovernor")
        GovernorSettings(
            1,
            7200,
            0
        )
        GovernorVotes(token)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(timelock)
    {}


    /*
     * GovernorSettings
     */

    function votingDelay()
        public
        view
        override(GovernorSettings, IGovernor)
        returns(uint256)
    {
        return super.votingDelay();
    }


    function votingPeriod()
        public
        view
        override(GovernorSettings, IGovernor)
        returns(uint256)
    {
        return super.votingPeriod();
    }


    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns(uint256)
    {
        return super.proposalThreshold();
    }



    /*
     * Quorum
     */

    function quorum(uint256 blockNumber)
        public
        view
        override(IGovernor, GovernorVotesQuorumFraction)
        returns(uint256)
    {
        return super.quorum(blockNumber);
    }


    /*
     * Timelock
     */

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns(ProposalState)
    {
        return super.state(proposalId);
    }


    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._execute(
            proposalId,
            targets,
            values,
            calldatas,
            descriptionHash
        );
    }


    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns(uint256)
    {
        return super._cancel(
            targets,
            values,
            calldatas,
            descriptionHash
        );
    }


    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns(address)
    {
        return super._executor();
    }


    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns(bool)
    {
        return super.supportsInterface(interfaceId);
    }
}