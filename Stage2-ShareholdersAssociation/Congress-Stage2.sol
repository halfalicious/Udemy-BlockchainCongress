//
// Simple Blockchain Congress smart contract created as a part of the Udemy class: 
//
//      "How to build Decentralized Auto Democracy DAO in Ethereum Blockchain"
//
//      https://www.udemy.com/how-to-build-decentralized-democracy-dao-in-ethereum-blockchain/learn/v4/content
//

pragma solidity ^0.4.13;

//
// TOOD: Comment
//
contract Token {
    mapping(address => uint) public balanceOf;
    
    function updateBalance(address _address, uint value) public returns (uint) {
        balanceOf[_address] += value;
        return balanceOf[_address];
    }
}

//
// Summary:
//      Simple class providing enforced ownership functionality, including
//      ownership transfer.
//
contract Ownership {
    address internal owner;

    modifier ownerOnly() {
        require(owner == msg.sender);
        _;
    }

    function Ownership() public {
        owner = msg.sender;
    }

    function transferOwnership(address _newOwner) ownerOnly public {
        owner = _newOwner;
    }
}

//
// TODO
//
contract Association is Ownership {
    // Time period after proposal is made during which participants vote
    uint internal votingPeriodMinutes;

    Token internal sharesAddress;

    // Proposal storage
    Proposal[] internal proposals;

    // Minimum number of votes required for a proposal to be evaluated
    uint minQuorum;

    //
    // Events
    //
    // Note:Cannot make variable-length data types indexed (e.g. bytes) because otherwise
    //      Truffle throws a "Number cannot store more than 53 bits" error
    event OnChangeVotingRules(uint minQuorum, uint votingPeriodMinutes);
    event OnNewProposal(uint indexed proposalId, address indexed beneficiary, bytes description);
    event OnExecuteProposal(
        uint indexed proposalId,
        address indexed beneficiary,
        uint payoutInWei,
        int currentResult,
        uint voteCount
    );
    event OnVote(
        uint indexed proposalId,
        address indexed voterAddress,
        bool indexed inFavor,
        uint votingWeight,
        bytes justification,
        uint voteCount,
        int currentResult
    );
    event OnTransferOwnership(
        address indexed previousOwner,
        address indexed newOwner
    );

    modifier shareholdersOnly() {
        // TODO: DOes this work? If so, how does this work? 
        require(sharesAddress.balanceOf(msg.sender) != 0);
        _;
    }

    // Defines a payout (e.g. the beneficiary, the payout amount) and the
    // conditions required for the payout to occur.
    struct Proposal {
        address beneficiary;
        uint payoutInWei;
        bytes description;

        //
        // Voting data
        //

        uint votingDeadlineSeconds;

        // Has the payout occurred and the associated transaction been
        // executed? Note that a proposal can be passed but not executed
        // (currentResult > 0 && currentResult < minPassMargin)
        bool executed;

        // Has the proposal been passed?
        bool passed;

        // <# pass votes> - <#no pass votes>
        int currentResult;

        // Vote storage
        Vote[] votes;

        // Vote count
        // Note: This is the number of votes in the vote array, where each
        //       vote is weighted by the number of shares owned by the
        //       voter. One can calculate this by iterating over the
        //       votes array looking up each voter's token balance, but
        //       we compute this as votes are cast in the interest of
        //       simplicity.
        uint voteCount;

        // Whether or not someone has voted. Not technically needed because
        // we can determine this using the votes array and the voteIds mapping,
        // but this makes it easier
        mapping (address => bool) voteRecord;
        mapping (address => uint) voteIds;

        // keccak32 hash of beneficiary, payout amount, and transaction bytes
        // (which are bytes of a transaction to execute as a part of payout)
        bytes32 proposalHash;
    }

    struct Vote {
        bool voteYes;

        // Arbitrary text that one can submit with their vote
        bytes justification;

        address voter;
    }

    function Association(
        address _sharesAddress,
        uint _minQuorum,
        uint _votingPeriodMinutes
    ) payable public {
        owner = msg.sender;
        changeVotingRules(_sharesAddress, _minQuorum, _votingPeriodMinutes);
    }

    function transferOwnershipToShareholder(address _shareholderAddress) ownerOnly shareholdersOnly public {
        address prevOwner = owner;
        transferOwnership(_shareholderAddress);

        OnTransferOwnership(prevOwner, owner);
    }

    function changeVotingRules(
        address _sharesAddress,
        uint _minQuorum,
        uint _votingPeriodMinutes
    ) public ownerOnly {
        require(_sharesAddress != 0);
        require(_minQuorum > 0);
        require(_votingPeriodMinutes > 0);

        sharesAddress = Token(_sharesAddress);
        minQuorum = _minQuorum;
        votingPeriodMinutes = _votingPeriodMinutes;

        OnChangeVotingRules(minQuorum, votingPeriodMinutes);
    }

    function newProposal(
        address _beneficiary,
        uint _payoutInWei,
        bytes _description,
        bytes _transactionByteCode
    ) shareholdersOnly public returns (uint _proposalId) {
        require(_payoutInWei > 0);
        require(_beneficiary != 0);

        uint proposalId = proposals.length++;
        
        // Create and initialize the Proposal
        Proposal storage proposal = proposals[proposalId];
        proposal.beneficiary = _beneficiary;
        proposal.payoutInWei = _payoutInWei;
        proposal.description = _description;
        proposal.proposalHash = keccak256(_beneficiary, _payoutInWei, _transactionByteCode);
        proposal.votingDeadlineSeconds = now + votingPeriodMinutes * 1 minutes;
        proposal.executed = false;
        proposal.passed = false;
        proposal.currentResult = 0;

        _proposalId = proposalId;

        OnNewProposal(proposalId, proposal.beneficiary, proposal.description);
    }

    function checkProposalCode(uint _proposalId, bytes _transactionByteCode) private constant returns (bool) {
        require(proposals[_proposalId].beneficiary != 0);
        Proposal storage proposal = proposals[_proposalId];
        return keccak256(proposal.beneficiary, proposal.payoutInWei, _transactionByteCode) == proposal.proposalHash;
    }

    function vote(uint _proposalId, bool _voteYes, bytes _justification) public shareholdersOnly returns (uint _voteId) {
        require(proposals[_proposalId].beneficiary != 0);
        require(!proposals[_proposalId].voteRecord[msg.sender]);

        Proposal storage proposal = proposals[_proposalId];

        uint voteId = proposal.votes.length++;

        Vote storage newVote = proposal.votes[voteId];
        newVote.voteYes = _voteYes;
        newVote.justification = _justification;
        newVote.voter = msg.sender;

        proposal.voteRecord[msg.sender] = true;
        proposal.voteIds[msg.sender] = voteId;
        proposal.voteCount += sharesAddress.balanceOf(msg.sender);
        if (_voteYes) {
            proposal.currentResult += (int)(sharesAddress.balanceOf(msg.sender));
        } else {
            proposal.currentResult -= (int)(sharesAddress.balanceOf(msg.sender));
        }
        _voteId = voteId;

        OnVote(
            _proposalId,
            msg.sender,
            newVote.voteYes,
            sharesAddress.balanceOf(msg.sender), // vote weight
            newVote.justification,
            proposal.voteCount,
            proposal.currentResult
        );
    }

    function executeProposal(uint _proposalId, bytes _transactionByteCode) ownerOnly public returns (bool) {
        Proposal storage proposal = proposals[_proposalId];

        require(proposal.beneficiary != 0);
        require(!proposal.executed);
        require(!proposal.passed);
        require(proposal.votingDeadlineSeconds <= now);
        require(proposal.currentResult > 0 && proposal.voteCount > minQuorum);
        require(checkProposalCode(_proposalId, _transactionByteCode));

        proposal.passed = true;
        proposal.executed = true;
        require(proposal.beneficiary.call.value(proposal.payoutInWei)(_transactionByteCode));
        OnExecuteProposal(_proposalId, proposal.beneficiary, proposal.payoutInWei, proposal.currentResult, proposal.voteCount);
    }

    function getVotingTimeLeft(uint _proposalId) shareholdersOnly constant public returns (uint) {
        require(proposals[_proposalId].beneficiary != 0);
        uint timeLeft = 0;
        if (now < proposals[_proposalId].votingDeadlineSeconds) {
            timeLeft = proposals[_proposalId].votingDeadlineSeconds - now;
        }
        return timeLeft;
    }

    function () external payable {}
}

