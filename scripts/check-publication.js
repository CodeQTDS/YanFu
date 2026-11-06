'use strict';
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process'), assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
assert.equal(read('VERSION').trim(),'1.0.0');
for(const value of [json('package.json').version,json('package-lock.json').version,json('package-lock.json').packages[''].version,json('config/app.config.json').version])assert.equal(value,'1.0.0');
for(const line of read('.env.example').split(/\r?\n/)) {
 const m=line.match(/^\s*(?:#\s*)?([A-Z0-9_]*(?:API_KEY|SECRET|PRIVATE_KEY|PASSWORD))\s*=(.*)$/);
 if(m)assert.equal(m[2].trim(),'','Example credentials must be blank: '+m[1]);
}
const privatePaths=['.env','.env.production','backend/.env','config/chain.config.json','config/registered-contracts.json','config/provider.local.json','wallets/account.json','secrets/token.txt','credentials.json','account.pem','account.key','account.keystore','.npmrc','node_modules/example.js','artifacts/a.json','cache/a.json','test/auto/results/report.json','audit/YANFU_v1.0_RESULTS.json','logs/node.log'];
const publicPaths=['.env.example','config/chain.config.example.json','config/registered-contracts.example.json','config/registered-contracts.catalog.example.json','README.md','package-lock.json'];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yanfu-publication-'));
try {
 cp.execFileSync('git',['init','--quiet'],{cwd:tmp});
 fs.copyFileSync(path.join(root,'.gitignore'),path.join(tmp,'.gitignore'));
 for(const p of privatePaths){const r=cp.spawnSync('git',['check-ignore','--no-index','--quiet','--',p],{cwd:tmp});assert.equal(r.status,0,'Missing ignore rule for '+p);}
 for(const p of publicPaths){assert(fs.existsSync(path.join(root,p)),'Missing template '+p);const r=cp.spawnSync('git',['check-ignore','--no-index','--quiet','--',p],{cwd:tmp});assert.equal(r.status,1,'Public example unexpectedly ignored: '+p);}
 // Exercise setup in isolation; sentinel contents prove a second run cannot overwrite local settings.
 fs.mkdirSync(path.join(tmp,'scripts'));fs.mkdirSync(path.join(tmp,'config'));
 fs.copyFileSync(path.join(root,'scripts/setup-local.js'),path.join(tmp,'scripts/setup-local.js'));
 for(const p of publicPaths.filter(p=>p.endsWith('.example')||p.includes('.example.json')))fs.copyFileSync(path.join(root,p),path.join(tmp,p));
 cp.execFileSync(process.execPath,['scripts/setup-local.js'],{cwd:tmp});
 const pairs=[['.env.example','.env'],['config/chain.config.example.json','config/chain.config.json'],['config/registered-contracts.example.json','config/registered-contracts.json']];
 for(const [a,b]of pairs){assert.deepEqual(fs.readFileSync(path.join(tmp,a)),fs.readFileSync(path.join(tmp,b)));fs.writeFileSync(path.join(tmp,b),'local sentinel');}
 cp.execFileSync(process.execPath,['scripts/setup-local.js'],{cwd:tmp});
 for(const [,b]of pairs)assert.equal(fs.readFileSync(path.join(tmp,b),'utf8'),'local sentinel');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
const docs=['README.md','START_HERE.md','ARCHITECTURE.md','SECURITY.md','CHANGELOG.md',...fs.readdirSync(path.join(root,'docs')).filter(p=>p.endsWith('.md')).map(p=>'docs/'+p)];
for(const doc of docs){for(const m of read(doc).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const link=m[1];if(/^(?:https?:|#)/.test(link))continue;const target=link.split('#')[0];assert(fs.existsSync(path.resolve(root,path.dirname(doc),target)),`Broken documentation link: ${doc} -> ${target}`);}}
const tracked=cp.spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});
if(tracked.status===0){for(const p of tracked.stdout.split('\0').filter(Boolean)){const ignored=cp.spawnSync('git',['check-ignore','--no-index','--quiet','--',p],{cwd:root});assert.notEqual(ignored.status,0,'Tracked file matches private/generated ignore rule: '+p);}}
console.log(`PASS v1.0 metadata, blank credential examples, ${privatePaths.length} private / ${publicPaths.length} public ignore cases, setup creation and no-overwrite, ${docs.length} documentation link checks`);
console.log(tracked.status===0?'PASS tracked-file ignore review':'INFO no Git repository yet; rerun after staging to check tracked files');
