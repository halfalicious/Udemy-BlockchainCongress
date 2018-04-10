// Unit tests for the Blockchain Shareholders Association smart contract created as a part of the Udemy course: 
//
//      "How to build Decentralized Auto Democracy DAO in Ethereum Blockchain"
//
//      https://www.udemy.com/how-to-build-decentralized-democracy-dao-in-ethereum-blockchain/learn/v4/content
// 

var Association = artifacts.require("./Association");
var Token = artifacts.require("./Token");
var chai = require('chai');

// Required for using Chai to test for rejected promises
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

const getRandomNumberUpToMax = function(max) {
    return getRandomNumberInRange(0, max);
}

const getRandomNumberInRange = function(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

//
// Helper class for generating list of shareholder accounts
// and token balances, given the supplied quorum arguments
// 
class ShareholderLib {
    // Populate list of shareholder accounts and generate token
    // balances for the accounts from the supplied quorum arguments.
    constructor (accounts, minQuorum, meetQuorum) {
        this._shareholders = new Array(accounts.length);
        for (let i = 0; i < accounts.length; i++) {
            this._shareholders[i] = { address: accounts[i], name: "Shareholder" + i };
        }
        this.generateBalances(minQuorum, meetQuorum);
    }
    
    get shareholders() {
        return this._shareholders;
    }

    set shareholders(newShareholders) {
        this._shareholders = newShareholders;
    }

    // Generate shareholder account token balances based on the
    // supplied quorum parameters.
    generateBalances(minQuorum, meetQuorum) {
        // minQuorum must be >= 2 so that a vote can still be cast
        // in the !meetQuorum scenario
        if (!minQuorum) {
            throw "minQuorum must be at least 2";
        }

        // Generate the token balances for each shareholder
        // Generation algorithm is simple - if the sum of all account balances doesn't
        // meet minQuorum after a pass is complete, double the maxTokenAllocationPerShareholder
        // and start again.
        var maxTokenAllocationPerShareholder = 10;
        var i = 0; 
        var totalBalance = 0;
        while (totalBalance < minQuorum || i < this._shareholders.length) {
            this._shareholders[i].balance = getRandomNumberInRange(1, maxTokenAllocationPerShareholder);
            totalBalance += this._shareholders[i].balance;
            if (i == this._shareholders.length - 1 && totalBalance < minQuorum) {
                maxTokenAllocationPerShareholder *= 2;
                totalBalance = 0;
                i = 0;
            }
            else {
                i++;
            }
        }
        
        // Adjust balances so they fit within quorum parameters
        this._shareholders.sort((a, b) => { return a.balance - b.balance } );
        if (!meetQuorum) {
            var poppedElement = null;
            while (totalBalance >= minQuorum) {
                poppedElement = this._shareholders.pop();
                totalBalance -= poppedElement.balance;
            }
            // Ensure that there's at least 1 voter with a non-zero balance
            // which doesn't meet the minQuorum so we can exercise the 
            // !meetQuorum scenario
            if (!this._shareholders.length)  {
                this._shareholders.push(poppedElement);
                poppedElement.balance = minQuorum - 1;
            }
        }
    }
 
    // Generate a list of shareholder votes
    getVotes(pass) {
        // Copy the shareholders array
        var votes = this._shareholders.slice(0);
        for (let i = 0; i < votes.length; i++) {
            if (i < votes.length / 2) {
                votes[i].vote = !pass;
            }
            else {
                votes[i].vote = pass;
            }
        }

        return votes;
    }
};

contract('Association', async (accounts) => {
    const VOTING_PERIOD_MINUTES = 5;
    const MIN_QUORUM = 5;
    const FUND_AMOUNT_ETHER = 3;
    
    // Contract instances
    var token = null;
    var association = null;

    var shareholderLib = null;
    var shareholders = null; // shareholder accounts and balances

    // Create a Token instance, populate it with the Shareholder balances, use it to create an
    // Association instance.
    beforeEach(async () => {
        console.log("Creating Token...");
        token = await Token.new();
        console.log("Populating Token with shareholder balances...");
        shareholderLib = new ShareholderLib(accounts, MIN_QUORUM, true);
        shareholders = shareholderLib.shareholders;
        for (let i = 0; i < shareholders.length; i++) {
            console.log("Updating shareholder " + shareholders[i].name + " with balance " + shareholders[i].balance);
            await token.updateBalance(
                    shareholders[i].address,
                    shareholders[i].balance
                    );
        }
        console.log("Creating association...");
        association = await Association.new(
                        token.address,
                        MIN_QUORUM,
                        VOTING_PERIOD_MINUTES,
                        { value: web3.toWei(FUND_AMOUNT_ETHER) }
                    );
    });    

    it('Can create proposal, shareholders can vote on proposal, and proposal can be executed', async () => {
        const beneficiary = accounts[getRandomNumberUpToMax(accounts.length - 1)];
        const payoutInEther = 1;
        const description = "Test Proposal";
        const proposalId = 0;
        const transactionByteCode = 0;
        var currentResult = 0;
        var voteCount = 0;

        // Create the proposal
        console.log("Creating new proposal for beneficiary: " + beneficiary);
        let result = await association.newProposal(beneficiary, web3.toWei(payoutInEther), description, 0);
        console.log("Proposal created!");
        assert.equal(result.logs[0].event, "OnNewProposal", "Expected event wasn't fired on proposal creation");
        assert.equal(result.logs[0].args.proposalId.valueOf(), proposalId, "ProposalId in event doesn't match proposal id sent to contract");
        assert.equal(result.logs[0].args.beneficiary, beneficiary, "Beneficiary address in event doesn't match beneficiary address sent to contract");
        assert.equal(web3.toAscii(result.logs[0].args.description), description, "Payout amount in event doesn't match payout amount sent to contract");

        console.log("Casting votes...");
        var votes = shareholderLib.getVotes(true);
        for (let i = 0; i < votes.length; i++) {
            console.log("Casting vote for: " + votes[i].address + " / " + votes[i].name + ", passVote: " + votes[i].vote + ", weight: " + votes[i].balance);
            if (votes[i].vote) {
                currentResult += votes[i].balance;
            } else {
                currentResult -= votes[i].balance;
            }
            voteCount += votes[i].balance;
            let result = await association.vote(proposalId, votes[i].vote, web3.fromAscii(votes[i].name), { from: votes[i].address });
            assert.equal(result.logs[0].event, "OnVote", "Expected event wasn't fired on vote cast");
            assert.equal(result.logs[0].args.voterAddress, votes[i].address, "Voter address in event doesn't match address of voter");
            assert.equal(result.logs[0].args.inFavor, votes[i].vote, "Vote in event doesn't match vote sent to contract");
            assert.equal(result.logs[0].args.votingWeight.valueOf(), votes[i].balance.valueOf(), "Vote weight in event doesn't match voter's balance in test data");
            assert.equal(web3.toAscii(result.logs[0].args.justification), votes[i].name, "Vote description in event doesn't match description sent to contract");
            assert.equal(result.logs[0].args.voteCount.valueOf(), voteCount, "Vote count in event doesn't match vote count computed in test");
            assert.equal(result.logs[0].args.currentResult.valueOf(), currentResult, "Current voting result in event doesn't match voting result computed in test");
        }

        // Fake passage of time and force block to be mined so block's timestamp
        // is incremented
        console.log("Forcing time travel and a mined block");
        await timeTravel((VOTING_PERIOD_MINUTES + 1) * 60);
        await forceMine();

        // Verify no voting time left
        result = await association.getVotingTimeLeft.call(proposalId);
        assert.equal(result.valueOf(), 0, "Proposal should have 0 voting time left");

        // Execute the proposal
        console.log("Executing proposal");
        result = await association.executeProposal(proposalId, transactionByteCode);
        assert.equal(result.logs[0].event, "OnExecuteProposal", "Expected event wasn't fired on proposal execution");      
        assert.equal(result.logs[0].args.proposalId.valueOf(), proposalId, "ProposalId in event doesn't match expected proposalId");
        assert.equal(result.logs[0].args.beneficiary, beneficiary, "Beneficiary address in event doesn't match beneficiary set in proposal");
        assert.equal(result.logs[0].args.payoutInWei.valueOf(), web3.toWei(payoutInEther), "Payout amount in event doesn't match payout amount set in proposal");
        assert.equal(result.logs[0].args.currentResult.valueOf(), currentResult.valueOf(), "Tallied result in event doesn't match computed result in test data");
        assert.equal(result.logs[0].args.voteCount.valueOf(), voteCount, "Vote count in event doesn't match computed vote count");
    });

    it('Proposal fails because there are more fail votes than pass votes', async () => {
        const beneficiary = accounts[getRandomNumberUpToMax(accounts.length - 1)];
        const payoutInEther = 1;
        const description = "Test Proposal";
        const proposalId = 0;
        const transactionByteCode = 0;
        var currentResult = 0;
        var voteCount = 0;
        let result = await association.newProposal(beneficiary, web3.toWei(payoutInEther), description, 0);

        console.log("Proposal created!");
        assert.equal(result.logs[0].event, "OnNewProposal", "Expected event wasn't fired on proposal creation");
        assert.equal(result.logs[0].args.proposalId.valueOf(), proposalId, "ProposalId in event doesn't match proposal id sent to contract");
        assert.equal(result.logs[0].args.beneficiary, beneficiary, "Beneficiary address in event doesn't match beneficiary address sent to contract");
        assert.equal(web3.toAscii(result.logs[0].args.description), description, "Payout amount in event doesn't match payout amount sent to contract");

        console.log("Casting votes...");
        var votes = shareholderLib.getVotes(false);
        for (let i = 0; i < votes.length; i++) {
            console.log("Casting vote for: " + votes[i].address + " / " + votes[i].name + ", passVote: " + votes[i].vote + ", weight: " + votes[i].balance);
            if (votes[i].vote) {
                currentResult += votes[i].balance;
            } else {
                currentResult -= votes[i].balance;
            }
            voteCount += votes[i].balance;
            let result = await association.vote(proposalId, votes[i].vote, web3.fromAscii(votes[i].name), { from: votes[i].address });
            assert.equal(result.logs[0].event, "OnVote", "Expected event wasn't fired on vote cast");
            assert.equal(result.logs[0].args.voterAddress, votes[i].address, "Voter address in event doesn't match address of voter");
            assert.equal(result.logs[0].args.inFavor, votes[i].vote, "Vote in event doesn't match vote sent to contract");
            assert.equal(result.logs[0].args.votingWeight.valueOf(), votes[i].balance.valueOf(), "Vote weight in event doesn't match voter's balance in test data");
            assert.equal(web3.toAscii(result.logs[0].args.justification), votes[i].name, "Vote description in event doesn't match description sent to contract");
            assert.equal(result.logs[0].args.voteCount.valueOf(), voteCount, "Vote count in event doesn't match vote count computed in test");
            assert.equal(result.logs[0].args.currentResult.valueOf(), currentResult, "Current voting result in event doesn't match voting result computed in test");
        }

        // Fake passage of time and force block to be mined so block's timestamp
        // is incremented
        console.log("Forcing time travel and a mined block");
        await timeTravel((VOTING_PERIOD_MINUTES + 1) * 60);
        await forceMine();

        // Verify no voting time left
        result = await association.getVotingTimeLeft.call(proposalId);
        assert.equal(result.valueOf(), 0, "Proposal should have 0 voting time left");

        // Execute the proposal
        console.log("Executing proposal");
        await association.executeProposal(proposalId, transactionByteCode).should.be.rejected;
    });
});