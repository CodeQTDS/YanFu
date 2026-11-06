const { ethers } = require("ethers");
const { loadChainConfig } = require("../config/configLoader");

let cachedProvider = null;
let cachedUrl = null;

function getProvider() {
  const config = loadChainConfig();
  if (!cachedProvider || cachedUrl !== config.rpcUrl) {
    cachedUrl = config.rpcUrl;
    cachedProvider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  }
  return cachedProvider;
}

module.exports = {
  getProvider
};
