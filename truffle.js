require("babel-core").transform("code", {
  plugins: ["transform-es2015-modules-commonjs"]
});
require('babel-register');
require('babel-polyfill');

module.exports = {
  networks: {
    development: {
      host: "localhost",
      port: 8545,
      network_id: "*" // Match any network id
    }
  }
};
