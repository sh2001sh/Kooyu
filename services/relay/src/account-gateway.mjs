import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, importJWK, calculateJwkThumbprint } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

export function accountGateway({issuer,controlOrigin,controlSecret,origin}){
 if(new URL(issuer).origin!==issuer||!issuer.startsWith('https://')||!controlSecret||controlSecret.length<32)throw Error('Invalid Relay account configuration');
 const control=new URL('/internal/v1/lease',controlOrigin);
 if(control.protocol!=='https:'&&!(control.protocol==='http:'&&['localhost','127.0.0.1'].includes(control.hostname)))throw Error('Control plane requires TLS or loopback');
 const keys=createRemoteJWKSet(new URL('/.well-known/jwks.json',issuer),{timeoutDuration:3000});
 const nonces=new Map();
 async function lease(claims,details={}){
 if(claims.exp*1000<=Date.now())throw Error('TOKEN_EXPIRED');
 let result;
 try {result=await fetch(control,{method:'POST',headers:{authorization:'Bearer '+controlSecret,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(3000),body:JSON.stringify({hostId:claims.hostId,relayHostId:claims.relayHostId,ownerId:claims.sub,grantId:claims.grantId,grantClientId:claims.pairedClientId,deviceId:claims.deviceId,pairId:claims.pairId,...details})});}
 catch{throw Error('SERVICE_UNAVAILABLE')}
 if(!result.ok){
   const decision=await result.json().catch(()=>({}));
   if(result.status===403 && ['DEVICE_REVOKED','ACCOUNT_DISABLED','TRANSACTION_CLOSED'].includes(decision.code))throw Error(decision.code);
   throw Error('SERVICE_UNAVAILABLE');
 }
 await result.body?.cancel();
 }
 async function verify(ticket,scope,host){
 if(typeof ticket!=='string'||ticket.length>6000)throw Error('ACCOUNT_REQUIRED');
 const {payload}=await jwtVerify(ticket,keys,{issuer,audience:scope,typ:'at+jwt',algorithms:['ES256'],requiredClaims:['exp','sub','jti','iat']});
 if(payload.scope!==scope||payload.relayHostId!==host||typeof payload.hostId!=='string'||!payload.cnf?.jkt||
 (scope==='relay:access'&&(!payload.grantId||!payload.deviceId)))throw Error('INVALID_TICKET');
 await lease(payload);return payload;
 }
 return {issuer,lease,uplink:(ticket,host)=>verify(ticket,'relay:uplink',host),
 nonce(){const now=Date.now();for(const [key,expiry] of nonces){if(expiry>now)break;nonces.delete(key)}
 if(nonces.size>=8192)throw Error('SERVICE_BUSY');const value=randomBytes(32).toString('base64url');nonces.set(value,now+60000);return value;},
 async access(req,host,allowPair=false){
 const ticket=req.headers['x-kooyu-ticket'];const pair=allowPair && req.headers['x-kooyu-purpose']==='pair';const claims=await verify(ticket,pair?'relay:pair':'relay:access',host);if(pair&&!claims.pairId)throw Error('INVALID_TICKET');
 const raw=req.headers.dpop;if(typeof raw!=='string'||raw.length>4000)throw Error('INVALID_PROOF');
 const {jwk}=decodeProtectedHeader(raw);if(!jwk||'d' in jwk||jwk.crv!=='P-256'||await calculateJwkThumbprint(jwk)!==claims.cnf.jkt)throw Error('INVALID_PROOF');
 const {payload}=await jwtVerify(raw,await importJWK(jwk,'ES256'),{algorithms:['ES256'],typ:'dpop+jwt',maxTokenAge:'60s',clockTolerance:3});
 const url=new URL(req.url,origin);
 if(payload.htm!==req.method||payload.htu!==origin+url.pathname||typeof payload.jti!=='string'||payload.jti.length<16||
 payload.ath!==createHash('sha256').update(ticket).digest('base64url')||!(nonces.get(payload.nonce)>Date.now()))throw Error('INVALID_PROOF');
 nonces.delete(payload.nonce);return claims;
 }};
}

