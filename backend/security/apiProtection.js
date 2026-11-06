"use strict";
// Local development boundary. This is not user authentication: remote/public
// deployment is intentionally unsupported until an auth/reverse-proxy layer exists.
const DEFAULT_ORIGINS=["http://localhost:5500","http://127.0.0.1:5500","http://localhost:5501","http://127.0.0.1:5501"];
function permittedOrigins(env=process.env) {
  return new Set(String(env.YANFU_ALLOWED_ORIGINS||DEFAULT_ORIGINS.join(","))
    .split(",").map(x=>x.trim()).filter(Boolean));
}
function localHost(host) { return ["127.0.0.1","::1","localhost"].includes(String(host)); }
function createApiProtection({env=process.env,clock=Date.now}={}) {
  const allowed=permittedOrigins(env), events=new Map();let activeAI=0;
  const maxPerMinute=Math.max(1,Number(env.YANFU_API_MAX_REQUESTS_PER_MINUTE||240));
  const maxActive=Math.max(1,Number(env.YANFU_API_MAX_ACTIVE_AI_REQUESTS||3));
  function middleware(req,res,next) {
    const origin=req.headers.origin;
    if(origin && !allowed.has(origin)) return res.status(403).json({success:false,error:"Untrusted browser origin"});
    if(origin){res.set("Access-Control-Allow-Origin",origin);res.set("Vary","Origin");res.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");res.set("Access-Control-Allow-Headers","Content-Type");}
    if(req.method==="OPTIONS")return res.status(204).end();
    if(!req.path.startsWith("/api") || req.method==="GET")return next();
    const ip=String(req.ip||req.socket?.remoteAddress||"unknown");
    const now=clock();const recent=(events.get(ip)||[]).filter(t=>now-t<60000);
    if(recent.length>=maxPerMinute){events.set(ip,recent);return res.status(429).json({success:false,error:"API rate limit exceeded"});}
    recent.push(now);events.set(ip,recent);
    const expensive=["/api/generate","/api/analyze","/api/review","/api/review/session"].includes(req.path);
    if(expensive){
      if(activeAI>=maxActive)return res.status(429).json({success:false,error:"AI concurrency quota exceeded"});
      activeAI++;
      let released=false;
      function release(){if(!released){released=true;activeAI=Math.max(0,activeAI-1)}}
      res.once("finish",release);res.once("close",release);
    }
    next();
  }
  return {middleware,allowed,limits:{maxPerMinute,maxActive},getActive:()=>activeAI};
}
module.exports={createApiProtection,permittedOrigins,localHost};
