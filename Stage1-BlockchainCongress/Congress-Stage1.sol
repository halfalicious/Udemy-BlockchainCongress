//
// Simple Blockchain Congress smart contract created as a part of the Udemy class: 
//
//      "How to build Decentralized Auto Democracy DAO in Ethereum Blockchain"
//
//      https://www.udemy.com/how-to-build-decentralized-democracy-dao-in-ethereum-blockchain/learn/v4/content
//

pragma solidity ^0.4.13;

//
// Simple smart contract providing enforced ownership functionality, including
// ownership transfer.
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
// Simple smart contract which models a Blockchain Congress. Initialized with a Congress leader
// and funded with Ether, the leader can add members and transfer ownership to another
// member. Members can make proposals (essentially payouts to members along with optional
// transactions to execute) and vote on them, and proposals with sufficient votes are
// executed when their voting deadline expires.
//
contract Congress is Ownership {
    // Minimum number of pass votes required for a proposal to be considered passed
    int internal minPassVotes;

    // Minimum delta between pass / no pass votes for a proposal to be considered passed
    int internal minPassMargin;

    // Time period after proposal is made during which participants vote
    uint internal votingPeriodMinutes;

     // Member addresses to "members" array indexes
    mapping(address => uint) internal memberIds;

    // Member storage
    Member[] internal members;

    // Proposal storage
    Proposal[] internal proposals;

    //
    // Events
    //
    // Note:Cannot make variable-length data types indexed (e.g. bytes) because otherwise
    //      Truffle throws a "Number cannot store more than 53 bits" error
    event OnVotingRulesChanged(int minPassVotes, uint votingPeriodMinutes, int minVoteMargin);
    event OnAddMember(address indexed memberAddress, bytes name);
    event OnRemoveMember(address indexed memberAddress, bytes name);
    event OnNewProposal(uint indexed proposalId, address indexed beneficiary, bytes description);
    event OnExecuteProposal(
        uint indexed proposalId,
        address indexed beneficiary,
        uint payoutInEther,
        int passMargin,
        uint voteCount
    );
    event OnVote(
        uint indexed proposalId,
        address indexed voterAddress,
        bool indexed inFavor,
        bytes justification
    );
    event OnTransferOwnership(
        address indexed previousOwner,
        address indexed newOwner
    );

    modifier memberOnly() {
        require(memberIds[msg.sender] != 0);
        _;
    }

    //
    // Custom data types
    //
    struct Member {
        address memberAddress;
        bytes name;
        uint memberSince;
    }

    // Defines a payout (e.g. the beneficiary, the payout amount) and the
    // conditions required for the payout to occur.
    struct Proposal {
        address beneficiary;
        uint payoutInEther;
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
        bool inFavor;

        // Arbitrary text that one can submit with their vote
        bytes justification;
    }

    function Congress(
        int _minPassVotes,
        uint _votingPeriodMinutes,
        int _minPassMargin
    ) payable public {
        owner = msg.sender;
        changeVotingRules(_minPassVotes, _votingPeriodMinutes, _minPassMargin);

        // Initialize with empty member since we can't use the first slot
        // in the members array to store any real data because we need a way to
        // check if an entry exists in the memberId map (memberIds[_address] == 0)
        members.push(Member({ memberAddress: 0, name: "", memberSince: now }));
        
        // Add the leader/owner
        addMember(owner, "Congress Leader");
    }

    function transferOwnershipToMember(address _memberAddress) ownerOnly public {
        require (memberIds[_memberAddress] != 0);
        address prevOwner = owner;
        transferOwnership(_memberAddress);

        OnTransferOwnership(prevOwner, owner);
    }

    function addMember(address _address, string _name) ownerOnly public {
        require(_address != 0);

        if (memberIds[_address] == 0) {
            memberIds[_address] = members.length;
            members.push(
                Member({ memberAddress: _address, name: bytes(_name), memberSince: now })
                );
        }
        Member storage member = members[memberIds[_address]];

        OnAddMember(member.memberAddress, member.name);
    }

    function removeMember(address _address) ownerOnly public {
        require(memberIds[_address] != 0);

        uint memberId = memberIds[_address];

        // Create a copy of the member that's being deleted so the member data
        // can be logged to an event after the member has been deleted
        Member memory memberToDelete = Member({   
            memberAddress: members[memberId].memberAddress,
            name: members[memberId].name,
            memberSince: members[memberId].memberSince
        });

        // "Delete" the member by shifting all members after it in the
        // array 1 to the left and reducing the array's length by 1
        for (uint i = memberIds[_address]; i < members.length - 1; i++)
        {
            members[i] = members[i + 1];
            memberIds[members[i].memberAddress]--;
        }
        memberIds[_address] = 0;
        members.length--;

        OnRemoveMember(memberToDelete.memberAddress, memberToDelete.name);
    }

    function changeVotingRules(
        int _minPassVotes,
        uint _votingPeriodMinutes,
        int _minPassMargin
    ) public ownerOnly {
        require(_minPassVotes > 0);
        require(_votingPeriodMinutes > 0);
        require(_minPassMargin > 0);

        minPassVotes = _minPassVotes;
        votingPeriodMinutes = _votingPeriodMinutes;
        minPassMargin = _minPassMargin;

        OnVotingRulesChanged(minPassVotes, votingPeriodMinutes, minPassMargin);
    }

    function newProposal(
        address _beneficiary,
        uint _payoutInEther,
        bytes _description,
        bytes _transactionByteCode
    ) memberOnly public returns (uint _proposalId) {
        require(memberIds[_beneficiary] != 0);
        require(_payoutInEther > 0);

        uint proposalId = proposals.length++;
        
        // Create and initialize the Proposal
        Proposal storage proposal = proposals[proposalId];
        proposal.beneficiary = _beneficiary;
        proposal.payoutInEther = _payoutInEther;
        proposal.description = _description;
        proposal.proposalHash = keccak256(_beneficiary, _payoutInEther, _transactionByteCode);
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
        return keccak256(proposal.beneficiary, proposal.payoutInEther, _transactionByteCode) == proposal.proposalHash;
    }

    function vote(uint _proposalId, bool _voteYes, bytes _justification) public memberOnly returns (uint _voteId) {
        require(proposals[_proposalId].beneficiary != 0);
        require(proposals[_proposalId].voteRecord[msg.sender] != true);

        Proposal storage proposal = proposals[_proposalId];

        uint voteId = proposal.votes.length++;
        Vote storage newVote = proposal.votes[voteId];
        newVote.justification = _justification;
        newVote.inFavor = _voteYes;

        proposal.voteRecord[msg.sender] = true;
        proposal.voteIds[msg.sender] = voteId;
        if (_voteYes) {
            proposal.currentResult++;
        } else {
            proposal.currentResult--;
        }
        _voteId = voteId;

        OnVote(_proposalId, msg.sender, newVote.inFavor, newVote.justification);
    }

    function executeProposal(uint _proposalId, bytes _transactionByteCode) ownerOnly public returns (bool) {
        Proposal storage proposal = proposals[_proposalId];

        require(proposal.beneficiary != 0);
        require(!proposal.executed);
        require(!proposal.passed);
        require(proposal.votingDeadlineSeconds <= now);
        require(proposal.currentResult > 0 && proposal.currentResult >= minPassVotes);
        require(checkProposalCode(_proposalId, _transactionByteCode));

        proposal.passed = true;
        if (proposal.currentResult >= minPassMargin) {
            proposal.executed = true;
            require(proposal.beneficiary.call.value(proposal.payoutInEther * 1 ether)(_transactionByteCode));
        }
        OnExecuteProposal(_proposalId, proposal.beneficiary, proposal.payoutInEther, proposal.currentResult, proposal.votes.length);
    }

    function getVotingTimeLeft(uint _proposalId) memberOnly constant public returns (uint) {
        require(proposals[_proposalId].beneficiary != 0);
        uint timeLeft = 0;
        if (now < proposals[_proposalId].votingDeadlineSeconds) {
            timeLeft = proposals[_proposalId].votingDeadlineSeconds - now;
        }
        return timeLeft;
    }

    function () external payable {}
}

