"use strict";
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pairs = [
  ['.env.example', '.env'],
  ['config/chain.config.example.json', 'config/chain.config.json'],
  ['config/registered-contracts.example.json', 'config/registered-contracts.json']
];
for (const [source, target] of pairs) {
  try {
    fs.copyFileSync(path.join(root, source), path.join(root, target), fs.constants.COPYFILE_EXCL);
    console.log(`CREATED ${target} from ${source}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`KEPT ${target} (existing local settings preserved)`);
  }
}
console.log('Local templates are ready. Set provider credentials in .env, then deploy to your disposable local chain.');
