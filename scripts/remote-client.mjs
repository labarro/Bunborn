import {encryptedGeneratedSecrets} from './private-secrets.mjs';
import{createHmac}from'node:crypto';
// Production is served on its custom domain; workers.dev remains an alternate address.
export const baseFor=env=>env==='production'?'https://bunborn.devbarros.com':`https://bunborn-${env}.luiisaugustoobad.workers.dev`;
export async function remoteClient(environment='homologation'){
 if(!['production','homologation'].includes(environment))throw new Error('invalid_environment');
 const secrets=await encryptedGeneratedSecrets(),base=baseFor(environment);
 // Owner-side automation signs an ordinary session using the encrypted SESSION_SECRET.
 // Browser login remains rate-limited; no repeated login attempts or secrets in output/files.
 const expires=String(Date.now()+23*3600000);const cookie='observador='+expires+'.'+createHmac('sha256',secrets[environment].session).update(expires).digest('hex');
 const response=await fetch(base+'/api/session',{headers:{cookie},signal:AbortSignal.timeout(30000)});const auth=await response.json();if(!auth.authenticated)throw new Error('remote_session_rejected');
 return {base,async request(path,body){const response=await fetch(base+'/api/'+path,{headers:{origin:base,cookie,'content-type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(240000)});const value=await response.json();if(!response.ok)throw new Error('remote_http_'+response.status+'_'+String(value.error??'unknown'));return value;}};
}
