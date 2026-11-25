import {cf,accountId} from './cloudflare.mjs';
import {encryptedGeneratedSecrets,readGemini,readProviderKey} from './private-secrets.mjs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const envName=process.argv[2];if(!['production','homologation'].includes(envName))throw new Error('environment_required');
const confirmation=JSON.parse(await readFile('.wrangler/private/cloudflare-free.json','utf8'));if(!confirmation.confirmed)throw new Error('cloudflare_free_not_confirmed');
const secrets=await encryptedGeneratedSecrets();const gemini=await readGemini();if(!gemini.confirmed)throw new Error('gemini_free_not_confirmed');
const cli=path.resolve('node_modules/wrangler/bin/wrangler.js');
// Groq and NVIDIA in both environments. NVIDIA trial terms forbid production use; the responsible
// observer explicitly accepted it for this personal, non-commercial project (25/11/2026). The router
// still only uses it in production while ai-config.allowTrialInProduction is true (panel toggle).
const groqKey=await readProviderKey('groq');const nvidiaKey=await readProviderKey('nvidia');
const extraSecrets={...(groqKey?{GROQ_API_KEY:groqKey}:{}),...(nvidiaKey?{NVIDIA_API_KEY:nvidiaKey}:{})};
for(const [name,text]of Object.entries({OBSERVER_SECRET:secrets[envName].observer,SESSION_SECRET:secrets[envName].session,GEMINI_API_KEY:gemini.key,...extraSecrets})){await cf(`/accounts/${accountId}/workers/scripts/bunborn-${envName}/secrets`,{method:'PUT',body:JSON.stringify({name,text,type:'secret_text'})});console.log(`${envName}: secret ${name} configurado (valor oculto)`);}
// Code after secrets: the Durable Object restarts once, already holding every secret.
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'deploy','--config',`wrangler.${envName}.jsonc`],{stdio:'inherit',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});child.on('exit',code=>code===0?resolve():reject(new Error('deploy_failed')));});
console.log(`${envName}: ${envName==='production'?'https://bunborn.devbarros.com':`https://bunborn-${envName}.luiisaugustoobad.workers.dev`}`);
