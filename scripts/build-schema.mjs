import {z} from 'zod';
import {decisionSchema} from '../shared/domain.ts';
import {writeFile} from 'node:fs/promises';
const full=z.toJSONSchema(decisionSchema);delete full.$schema;
function brief(s){if(s.const!==undefined)return s.const;if(s.enum)return s.enum.join('|');if(s.anyOf||s.oneOf){const options=(s.anyOf??s.oneOf).map(brief);
// Unions must not look like arrays: models read [A,B] literally as a list (benchmark 25/11).
return options.every(o=>typeof o==='string')?options.join(' | '):{'UM_DESTES_OBJETOS (escolha exatamente um; o valor é um objeto, nunca uma lista)':options};}if(s.type==='object')return Object.fromEntries(Object.entries(s.properties??{}).map(([k,v])=>[k,brief(v)]));if(s.type==='array')return {LISTA_DE:brief(s.items),maxItens:s.maxItems};return [s.type,s.minimum!==undefined?`min ${s.minimum}`:'',s.maximum!==undefined?`max ${s.maximum}`:'',s.maxLength?`maxLength ${s.maxLength}`:''].filter(Boolean).join(' ');}
const toolManifest=(full.properties.actions.items.anyOf??full.properties.actions.items.oneOf).map(brief);
function transportSchema(value){if(Array.isArray(value))return value.map(transportSchema);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([key])=>!['minItems','maxItems','minimum','maximum','minLength','maxLength','pattern'].includes(key)).map(([key,item])=>[key==='oneOf'?'anyOf':key,transportSchema(item)]));}
const schema=transportSchema(full);schema.properties.actions.maxItems=3;schema.properties.nextMinutes.minimum=3;schema.properties.nextMinutes.maximum=60;
await writeFile(new URL('../shared/decision.schema.json',import.meta.url),JSON.stringify(schema,null,2)+'\n');
await writeFile(new URL('../shared/tool-contracts.json',import.meta.url),JSON.stringify(toolManifest,null,2)+'\n');
console.log('Contrato JSON pré-compilado para evitar geração de schema na CPU do Worker.');
