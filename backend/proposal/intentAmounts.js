"use strict";
// Conservative parsing: evaluate only explicit amount+recipient pairs in common
// Treasury language. Unknown or ambiguous phrasing is NOT assumed to be safe;
// other semantic checks and the independent review remain mandatory.
const amountToAddress = /\b(\d+(?:\.\d+)?)\s*(MTK|tokens?|ETH|ethers?)\b[^.;,\n]{0,110}?\bto\s+(0x[a-fA-F0-9]{40})/gi;
const addressThenAmount = /\bto\s+(0x[a-fA-F0-9]{40})\s*(?:for|:)\s*(\d+(?:\.\d+)?)\s*(MTK|tokens?|ETH|ethers?)\b/gi;
const totalAmount = /\b(?:total|aggregate|sum)\s+(?:amount\s+)?(?:transferred|transfer|outflow|payment|payments)?\s*(?:must\s+be\s+|is\s+|of\s+|=\s+|exactly\s+)*\s*(\d+(?:\.\d+)?)\s*(MTK|tokens?|ETH|ethers?)\b/gi;
function canon(value) {
  const s=String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [whole,frac=""] = s.split(".");
  const w=whole.replace(/^0+(?=\d)/,"") || "0";
  const f=frac.replace(/0+$/,"");
  return f ? `${w}.${f}` : w;
}
function scaled(value) {
  const v=canon(value); if(v===null)return null;
  const [w,f=""]=v.split(".");
  if(f.length>18)return null;
  return BigInt(w)*10n**18n+BigInt(f.padEnd(18,"0"));
}
function asset(unit) { return /^(?:eth|ether)$/i.test(String(unit)) ? "ETH" : "ERC20"; }
function extractExplicitTransferIntent(sourceText) {
  const s=String(sourceText||"");const pairs=[];const seen=new Set();
  for (const re of [amountToAddress,addressThenAmount]){
    re.lastIndex=0;
    for(const m of s.matchAll(re)){
      const isReversed=re===addressThenAmount;
      const amount=isReversed?m[2]:m[1];
      const address=(isReversed?m[1]:m[3]).toLowerCase();
      const unit=isReversed?m[3]:m[2];
      const key=`${m.index}:${address}:${amount}`;
      if(!seen.has(key)){pairs.push({address,amount:canon(amount),asset:asset(unit),source:m[0]});seen.add(key)}
    }
  }
  totalAmount.lastIndex=0;
  const totals=[...s.matchAll(totalAmount)].map(m=>({amount:canon(m[1]),asset:asset(m[2])}));
  return {pairs,totals};
}
function collectTransfers(proposal) {
  const actions=Array.isArray(proposal?.actions)&&proposal.actions.length ? proposal.actions : proposal?.plan?.operations || [];
  const out=[];
  for(const item of actions) {
    const id=item.capabilityId||item.sourceCapabilityId||"";
    const args=item.arguments||{};
    const assetType=/ETH$/.test(id)?"ETH":/ERC20$/.test(id)?"ERC20":null;
    if(!assetType || !/^treasury\.(?:batchTransfer|transfer)/.test(id)) continue;
    if(id.includes("batch")){
      const recipients=args.recipients||[],amounts=args.amounts||[];
      if(!Array.isArray(recipients)||!Array.isArray(amounts)||recipients.length!==amounts.length)continue;
      for(let i=0;i<recipients.length;i++)out.push({address:String(recipients[i]).toLowerCase(),amount:canon(amounts[i]),asset:assetType});
    }else out.push({address:String(args.to||"").toLowerCase(),amount:canon(args.amount),asset:assetType});
  }
  return out;
}
function transferIntentFindings({sourceText,proposal}) {
  const explicit=extractExplicitTransferIntent(sourceText);
  if(!explicit.pairs.length && !explicit.totals.length)return [];
  const transfers=collectTransfers(proposal), findings=[];
  const key=p=>`${p.asset}|${p.address}|${p.amount}`;
  const counts=new Map();for(const t of transfers)counts.set(key(t),(counts.get(key(t))||0)+1);
  for(const pair of explicit.pairs){
    const k=key(pair),n=counts.get(k)||0;
    if(n)counts.set(k,n-1);else findings.push({source:"source-intent",severity:"HIGH",category:"explicit-transfer-amount-mismatch",message:`Requested ${pair.amount} ${pair.asset} to ${pair.address}, but this exact recipient/amount pair is absent from the current transfer operations.`,suggestion:"Preserve exact recipient and amount; if intentionally changed, recompile a new authoritative request or explicitly use Human Authority risk override."});
  }
  // Do not accept unrequested extra recipients/payments merely because all
  // explicitly listed recipients are present somewhere in a larger batch.
  const explicitAssets=new Set(explicit.pairs.map(p=>p.asset));
  for(const [remaining,count] of counts.entries()){
    if(count <= 0 || !explicitAssets.has(remaining.split("|")[0])) continue;
    findings.push({source:"source-intent",severity:"HIGH",category:"unrequested-transfer",message:`${count} additional transfer(s) not matched to any explicit recipient/amount pair: ${remaining}.`,suggestion:"Remove unrequested payments or ask the user to authorize the additional recipient and amount explicitly."});
  }
  for(const total of explicit.totals){
    const relevant=transfers.filter(t=>t.asset===total.asset);
    const values=relevant.map(t=>scaled(t.amount));
    const actual=values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0n):null;
    if(actual===null||scaled(total.amount)!==actual){
      findings.push({source:"source-intent",severity:"HIGH",category:"explicit-transfer-total-mismatch",message:`Explicit total ${total.amount} ${total.asset} does not equal the encoded semantic transfer total.`,suggestion:"Reconcile the exact declared total and individual payments."});
    }
  }
  return findings;
}
module.exports={canon,scaled,extractExplicitTransferIntent,collectTransfers,transferIntentFindings};
