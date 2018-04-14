var Congress = artifacts.require("./Congress");

module.exports = function(deployer) {
  deployer.deploy(
    Congress,
    2, // min # pass votes
    1, // voting duration in minutes
    1  // min pass margin (in votes)
  );
};
