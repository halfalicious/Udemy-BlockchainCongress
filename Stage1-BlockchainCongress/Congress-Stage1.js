// Unit tests for the Blockchain Congress smart contract created as a part of the Udemy course: 
//
//      "How to build Decentralized Auto Democracy DAO in Ethereum Blockchain"
//
//      https://www.udemy.com/how-to-build-decentralized-democracy-dao-in-ethereum-blockchain/learn/v4/content
// 

var Congress = artifacts.require("./Congress");
var chai = require('chai');

// Required for using Chai to test for exceptions
var chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
chai.should();

// Function which leverages a TestRPC function to fake the passage of time
const timeTravel = function (timeInSeconds) {
    return new Promise((resolve, reject) => {
      web3.currentProvider.sendAsync({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [timeInSeconds], // 86400 is num seconds in day
        id: new Date().getTime()
      }, (err, result) => {
        if(err){ return reject(err) }
        return resolve(result)
      });
    })
  }

  // Function which leverages a TestRPC function to force a block to be mined
  const forceMine = function() {
      return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: 12345
        }, (err, result) =>  {
            if (err) { return reject(err) }
            return resolve(result);
        });
      });
  }

contract('Congress', function (accounts) {

    //
    // Helper functions
    //

    function getNonMemberAccountIndex() {
        var i = 0;
        while (i < testMembers.length) {
            i = Math.floor(Math.random() * accounts.length);
        }
        return i;
    }

    function getNonOwnerAccountIndex() {
        var i = 0;
        while (i == 0) {
            i = Math.floor(Math.random() * testMembers.length);
        }
        return i;
    }

    const testMembers = [
        { address: accounts[0], name: "Alice" },
        { address: accounts[1], name: "Bob" },
        { address: accounts[2], name: "Charlie" },
        { address: accounts[3], name: "Carol" }
    ];
    const congressLeader = testMembers[0];

    const MIN_PASS_VOTES = 2;
    const VOTING_PERIOD_MINUTES = 5;
    const MIN_PASS_MARGIN = 1;
    const CONGRESS_FUND_AMOUNT_ETHER = 3; // in ether

    var congress;
    beforeEach(async () => {
        console.log("Creating new Congress...");
        congress = await Congress.new(MIN_PASS_VOTES, VOTING_PERIOD_MINUTES, MIN_PASS_MARGIN, { from: congressLeader.address, value: web3.toWei(CONGRESS_FUND_AMOUNT_ETHER) });
        for (let i = 0; i < testMembers.length; i++) {
            if (testMembers[i] != congressLeader) {
                console.log("Adding member: address: " + testMembers[i].address + ", name: " + testMembers[i].name);
                await congress.addMember(testMembers[i].address, testMembers[i].name);
            }
        }
    });

    it('Can add member to congress and remove member from congress', async () => {
        // Add member
        const testMember = { address: accounts[getNonMemberAccountIndex()], name: "Wendy" };
        console.log("Adding member with address(" + testMember.address +"), name(" + testMember.name + ")");
        let result = await congress.addMember(testMember.address, testMember.name);
        assert.equal(result.logs[0].event, "OnAddMember", "Expected event wasn't fired when member was added");
        assert.equal(result.logs[0].args.memberAddress, testMember.address, "Member address in event doesn't match member address in test data");
        assert.equal(web3.toAscii(result.logs[0].args.name), testMember.name, "Member name in event doesn't match member name in test data");

        // Remove member
        result = await congress.removeMember(testMember.address);
        assert.equal(result.logs[0].event, "OnRemoveMember", "Expected event wasn't fired when member was removed");
        assert.equal(result.logs[0].args.memberAddress, testMember.address, "Member address in event doesn't match member address in test data");
        assert.equal(web3.toAscii(result.logs[0].args.name), testMember.name, "Member name in event doesn't match member name in test data");
    });

    it('Can transfer ownership to member and non-owner cannot add or remove member', async () => {
        const previousOwnerAddress = congressLeader.address;
        const newOwnerAddress = testMembers[getNonOwnerAccountIndex()].address;
        console.log("Transferring ownership from " + previousOwnerAddress + " to " + newOwnerAddress);
        var result = await congress.transferOwnershipToMember(newOwnerAddress);
        assert.equal(result.logs[0].event, "OnTransferOwnership", "Expected event wasn't fired on ownership transfer");
        assert.equal(result.logs[0].args.previousOwner, previousOwnerAddress, "Previous owner address in event doesn't match previous owner address in test data");
        assert.equal(result.logs[0].args.newOwner, newOwnerAddress, "New owner address in event doesn't match new owner address in test data");
        
        // Verify that the previous owner can't perform owner actions anymore
        const newMember = { address: accounts[getNonMemberAccountIndex()].address, name: "Sybil" };
        console.log("Attempting to add new member using old owner account");
        await congress.addMember(newMember.address, newMember.name).should.be.rejected;
    });

    it('Cannot add invalid member to congress', async () => {
        // Add invalid member
        const testInvalidMember = { address: 0, name: "" };
        const testValidMember = { address: accounts[getNonMemberAccountIndex()], name: "Oscar"};
        console.log("Adding invalid member with address(" + testInvalidMember.address +"), name(" + testInvalidMember.name + ")");
        await congress.addMember(testInvalidMember.address, testInvalidMember.name).should.be.rejected;
    });

    it('Cannot remove non-existent member from congress', async () => {
        await congress.removeMember(accounts[getNonMemberAccountIndex()]).should.be.rejected;
    });


    it('Can propose proposal, members can vote on proposal, and proposal can be executed', async () => {
        const beneficiary = accounts[getNonOwnerAccountIndex()];
        const payoutAmountInEther = 1;
        const description = "Test Proposal";
        const proposalId = 0;
        const transactionByteCode = 0;

        // Create the proposal
        console.log("Creating new proposal...");
        let result = await congress.newProposal(beneficiary, payoutAmountInEther, description, 0);
        assert.equal(result.logs[0].event, "OnNewProposal", "Expected event wasn't fired on proposal creation");
        assert.equal(result.logs[0].args.proposalId.valueOf(), proposalId, "ProposalId in event doesn't match proposal id sent to contract");
        assert.equal(result.logs[0].args.beneficiary, beneficiary, "Beneficiary address in event doesn't match beneficiary address sent to contract");
        assert.equal(web3.toAscii(result.logs[0].args.description), description, "Payout amount in event doesn't match payout amount sent to contract");

        // Each member votes on the proposal, all vote yes except for 1 so the proposal will pass
        // and can be executed
        console.log("Casting votes...");
        var voteYesCount = 0;
        var voteNoCount = 0;
        for (var i = 0; i < testMembers.length; i++) {
            var voteYes = (i > 0);
            if (voteYes) voteYesCount++;
            else voteNoCount++;
            console.log("Casting vote for: " + testMembers[i].address + ", name: " + testMembers[i].name);
            let result = await congress.vote(proposalId, voteYes, testMembers[i].name, { from: testMembers[i].address });
            assert.equal(result.logs[0].event, "OnVote", "Expected event wasn't fired on vote cast");
            assert.equal(result.logs[0].args.voterAddress, testMembers[i].address, "Voter address in event doesn't match address of voter");
            assert.equal(result.logs[0].args.inFavor, voteYes, "Vote in event doesn't match vote sent to contract");
            assert.equal(web3.toAscii(result.logs[0].args.justification), testMembers[i].name, "Vote description in event doesn't match description sent to contract");
        }

        // Fake passage of time and force block to be mined so block's timestamp
        // is incremented
        console.log("Forcing time travel and a mined block");
        await timeTravel((VOTING_PERIOD_MINUTES + 1) * 60);
        await forceMine();

        // Verify no voting time left
        result = await congress.getVotingTimeLeft.call(proposalId);
        assert.equal(result.valueOf(), 0, "Proposal should have 0 voting time left");

        // Execute the proposal
        console.log("Executing proposal");
        result = await congress.executeProposal(proposalId, transactionByteCode);
        assert.equal(result.logs[0].event, "OnExecuteProposal", "Expected event wasn't fired on proposal execution");      
        assert.equal(result.logs[0].args.proposalId.valueOf(), proposalId, "ProposalId in event doesn't match expected proposalId");
        assert.equal(result.logs[0].args.beneficiary, beneficiary, "Beneficiary address in event doesn't match beneficiary set in proposal");
        assert.equal(result.logs[0].args.payoutInEther.valueOf(), payoutAmountInEther, "Payout amount in event doesn't match payout amount set in proposal");
        assert.equal(result.logs[0].args.passMargin.valueOf(), voteYesCount - voteNoCount, "Pass margin in event doesn't match computed pass margin");
        assert.equal(result.logs[0].args.voteCount.valueOf(), voteYesCount + voteNoCount, "Vote count in event doesn't match computed vote count");
    });
});