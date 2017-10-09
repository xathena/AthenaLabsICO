const AthenaLabsICO = artifacts.require("./AthenaLabsICO.sol");

module.exports = function(deployer, network, accounts) {

    // const startTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + 1 // one second in the future, Expected 7 Oct 17:00 UTC
    // const endOfRound1  = startTime + (3 * 86400) // + 3 days, Expected 10 Oct 17:00 UTC
    // const endOfRound2  = endOfRound1 + (4 * 86400) // + 4 days, Expected 14 Oct 17:00 UTC
    // const endOfRound3  = endOfRound2 + (5 * 86400) // + 5 days, Expected 19 Oct 17:00 UTC
    // const endOfRound4  = endOfRound3 + (6 * 86400) // + 6 days, Expected 25 Oct 17:00 UTC
    // const endOfRound5  = endOfRound4 + (7 * 86400) // + 7 days, Expected 1 Nov 17:00 UTC
    // const endOfRound6  = endOfRound5 + (8 * 86400) // + 8 days, Expected 9 Nov 17:00 UTC
    // const endTime  = endOfRound6 + (9 * 86400) // + 9 days, Expected 18 Nov 17:00 UTC

    // TESTING ONLY
    const startTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + 1 // one second in the future
    const endOfRound1  = startTime + (5 * 60);   // + 5 minutes, for testing only
    const endOfRound2  = endOfRound1 + (5 * 60);
    const endOfRound3  = endOfRound2 + (5 * 60);
    const endOfRound4  = endOfRound3 + (5 * 60);
    const endOfRound5  = endOfRound4 + (5 * 60);
    const endOfRound6  = endOfRound5 + (5 * 60);
    const endTime      = endOfRound6 + (5 * 60);
    const maxFinalizationTime = endTime + (60*60);
    const mainWallet   = accounts[0];
    const adminAccount1 = accounts[1];
    const adminAccount2 = accounts[1];
    const adminAccount3 = accounts[1];

    // END OF TESTING

    deployer.deploy( AthenaLabsICO
                   , startTime
                   , [endOfRound1, endOfRound2, endOfRound3, endOfRound4, endOfRound5, endOfRound6, endTime]
                   , maxFinalizationTime
                   , mainWallet
                   , [adminAccount1, adminAccount2, adminAccount3]);
};
