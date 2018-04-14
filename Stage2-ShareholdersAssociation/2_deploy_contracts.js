var Association = artifacts.require("./Association");
var Token = artifacts.require("./Token");

module.exports = function(deployer) {
  deployer.deploy(
    Association,
    2,
    1,
    1
  );
  deployer.deploy(Token);
};
