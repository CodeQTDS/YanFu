"use strict";
// Offline pre-GitHub suite validation; uses real v1.0 source-intent code.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const file = path.join(ROOT, "test/auto/yanfu-ai-pipeline-cases.json");
const suite = JSON.parse(fs.readFileSync(file, "utf8"));
const definitions = JSON.parse(fs.readFileSync(path.join(ROOT,"config/proposal-elements.json"),"utf8"));
const known = new Set(definitions.capabilities.map(x => x.id));
const { extractExplicitTransferIntent, transferIntentFindings } = require("../backend/proposal/intentAmounts");
let checks = 0;
function ok(predicate, label){assert(predicate,label);checks++;}
const ids = new Set();
ok(suite.targetYanFuVersion === "1.0.0", "v1.0 required");
ok(Array.isArray(suite.cases) && suite.cases.length >= 200, "at least 200 release cases");
let enabled=0,optional=0,positive=0,negative=0;
for(const [index,c] of suite.cases.entries()){
  ok(typeof c.id === "string" && c.id.length >= 5 && !ids.has(c.id), `unique ID ${index}`);ids.add(c.id);
  ok(typeof c.text === "string" && c.text.trim().length >= 12, `${c.id} nonempty request`);
  ok(c.expected && c.expected.compile && typeof c.expected.compile.success === "boolean",`${c.id} expected compile`);
  ok(Array.isArray(c.tags) && typeof c.group === "string",`${c.id} provenance tags`);
  if(c.enabled === false)optional++;else enabled++;
  if(c.expected.compile.success){
    positive++;
    for(const name of c.expected.compile.capabilities || [])ok(known.has(name)||c.enabled===false,`${c.id} known enabled capability ${name}`);
    for(const args of c.expected.compile.operationArguments || []){
      ok(args && typeof args === "object" && !Array.isArray(args),`${c.id} exact-argument object`);
    }
  } else negative++;
}
ok(enabled > 75 && optional > 70, "enabled and opt-in coverage");
ok(positive > 90 && negative > 70,"positive and negative coverage");
const smoke = suite.cases.filter(c=>c.enabled !== false && c.tags.includes("smoke"));
ok(smoke.length >= 10 && smoke.length <= 20,"affordable smoke filter");
for(const id of ["builtin-treasury-eth-single-positive","builtin-treasury-eth-batch-positive","builtin-treasury-erc20-single-positive","builtin-treasury-erc20-batch-positive","release-erc20-batch-07-ordered","release-governance-triple-extreme"]){ok(ids.has(id),`${id} present`);}
const golden=suite.cases.find(x=>x.id==="release-erc20-batch-07-ordered");
const args=golden.expected.compile.operationArguments[0];
ok(args.recipients.length===7 && args.amounts.map(Number).reduce((a,b)=>a+b,0)===280,"exact 280 MTK case");
const extracted=extractExplicitTransferIntent(golden.text);
ok(extracted.pairs.length===7 && extracted.totals.some(t=>t.amount==="280"),"real parser extracts 7 pairs + 280 total");
const op={capabilityId:"treasury.batchTransferERC20",arguments:{token:"0x"+"1".repeat(40),recipients:args.recipients,amounts:args.amounts}};
const proposal={plan:{operations:[op]}};
ok(transferIntentFindings({sourceText:golden.text,proposal}).length===0,"valid batch no false blockers");
for(let i=0;i<7;i++){
 const broken={plan:{operations:[{...op,arguments:{...op.arguments,amounts:[...args.amounts]}}]}};
 broken.plan.operations[0].arguments.amounts[i]=String(Number(args.amounts[i])+10);
 ok(transferIntentFindings({sourceText:golden.text,proposal:broken}).some(f=>f.severity==="HIGH"),`recipient ${i} amount tampering must fail`);
}
console.log(JSON.stringify({status:"PASS",checks,cases:suite.cases.length,enabled,optional,positive,negative,smokeCases:smoke.length,groups:[...new Set(suite.cases.map(x=>x.group))]},null,2));
