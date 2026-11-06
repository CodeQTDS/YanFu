"use strict";
const crypto = require("crypto");
const { proposalFingerprint } = require("../proposal/integrity");
// The process key is NOT published to frontend. It can be supplied through
// YANFU_REVIEW_ATTESTATION_SECRET (>=32 bytes), otherwise process-local random.
// A restart with an ephemeral key intentionally invalidates old review sessions.
const supplied = process.env.YANFU_REVIEW_ATTESTATION_SECRET;
if (supplied && Buffer.byteLength(supplied,"utf8") < 32) throw new Error("YANFU_REVIEW_ATTESTATION_SECRET must contain at least 32 bytes");
const secret = supplied ? Buffer.from(supplied,"utf8") : crypto.randomBytes(32);
const TTL_MS = 24*60*60*1000;
function signPayload(payload) {
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac=crypto.createHmac("sha256",secret).update(encoded).digest("base64url");
  return `${encoded}.${mac}`;
}
function issueReviewAttestation(session) {
  const payload={v:1,sid:session.sessionId,fp:session.proposalFingerprint,verdict:session.aggregate?.verdict,issuedAt:Date.now()};
  return signPayload(payload);
}
function verifyReviewAttestation({proposal,reviewSession,priorReviewedFingerprint=null}) {
  const fail=reason=>({valid:false,current:false,reason});
  if (!reviewSession?.attestation) return fail("Review receipt missing; re-run AI Review after upgrade.");
  const [encoded,provided,...extra]=String(reviewSession.attestation).split(".");
  if (!encoded||!provided||extra.length||encoded.length>4096) return fail("Malformed review receipt");
  const expected=crypto.createHmac("sha256",secret).update(encoded).digest();
  let providedBytes;
  try {providedBytes=Buffer.from(provided,"base64url")}catch(_){return fail("Malformed signature")}
  if(expected.length!==providedBytes.length || !crypto.timingSafeEqual(expected,providedBytes))return fail("Invalid server review receipt");
  let claims;try{claims=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"))}catch(_){return fail("Invalid review receipt claims")}
  if(claims.v!==1 || !claims.sid || !claims.fp || !["APPROVE","NEEDS_CHANGES","REJECT"].includes(claims.verdict))return fail("Invalid review receipt payload");
  if(!Number.isFinite(claims.issuedAt)||claims.issuedAt>Date.now()+60000||Date.now()-claims.issuedAt>TTL_MS)return fail("Review receipt expired; run AI Review again");
  if(claims.sid!==reviewSession.sessionId||claims.fp!==reviewSession.proposalFingerprint||claims.verdict!==reviewSession.aggregate?.verdict)return fail("Review session data differ from the signed review");
  const currentFingerprint=proposalFingerprint(proposal);
  if(currentFingerprint===claims.fp) return {valid:true,current:true,verdict:claims.verdict,proposalFingerprint:claims.fp};
  if(priorReviewedFingerprint===claims.fp && proposal?.metadata?.editedBy==="HUMAN")return {valid:true,current:false,verdict:claims.verdict,proposalFingerprint:claims.fp};
  return fail("Review receipt does not match current payload or authorized human edit lineage");
}
module.exports={issueReviewAttestation,verifyReviewAttestation};
