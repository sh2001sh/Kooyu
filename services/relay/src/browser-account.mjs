import {createHash} from 'node:crypto';

export async function browserAccount(req,res,url,issuer,origin){
 if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-kooyu-request']!=='1')return respond(403,{code:'INVALID_ORIGIN'});
 const route=/^\/v1\/browser\/(config|nonce|credential-hash|logout|ticket|pairing\/claim|pairing\/finish)$/.exec(url.pathname)?.[1];
 if(!route)return respond(404,{code:'NOT_FOUND'});
 if(route==='config')return respond(200,{issuer});
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>8192)return respond(413,{code:'PAYLOAD_TOO_LARGE'});chunks.push(chunk);}
 const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),host=body.hostId;
 if(route!=='nonce' && (typeof host!=='string'||!/^[a-f0-9-]{36}$/.test(host)))return respond(400,{code:'INVALID_HOST'});
 const name='__Host-kooyu-device-'+host;
 const headers={'content-type':'application/json'};
 if(typeof req.headers.dpop==='string')headers.dpop=req.headers.dpop;
 if(route==='credential-hash'){
 const saved=String(req.headers.cookie??'').split(/;\s*/).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
 return saved ? respond(200,{ath:createHash('sha256').update(saved).digest('base64url')}) : respond(401,{code:'DEVICE_APPROVAL_REQUIRED'});
 }
 if(route==='ticket'||route==='logout'){
 body.rotate=true;
 const token=route==='ticket'&&body.role==='pair'?body.secret:String(req.headers.cookie??'').split(/;\s*/).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
 if(!token||(route==='ticket'&&!['device','pair'].includes(body.role)))return respond(401,{code:'DEVICE_APPROVAL_REQUIRED'});
 headers.authorization='DPoP '+token;delete body.secret;
 }
 const response=await fetch(issuer+'/api/device-auth/v1/'+route,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
 const value=await response.json();
 if(response.ok && route==='logout')res.setHeader('set-cookie',name+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
 if(response.ok && value.renewal && (route==='ticket'||(route==='pairing/finish'&&value.state==='active'))){
 if(route==='pairing/finish' && value.hostId!==host)return respond(409,{code:'INVALID_HOST'});
 const renewal=value.renewal;delete value.renewal;
 res.setHeader('set-cookie',name+'='+renewal+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=7776000');
 value.ath=createHash('sha256').update(renewal).digest('base64url');
 }
 return respond(response.status,value);
 function respond(status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
}
