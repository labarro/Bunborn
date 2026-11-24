type Manifest={id:string;upper:Record<string,number>;version:2};
type Segment={table:string;after:number;rows:unknown[];digest:string;next:number|null};
type Header={table:string;after:number;count:number;digest:string};
// Logical history cap is 180 MB; JSON escaping adds overhead, so the browser accepts
// files up to the 400 MB physical guard. Larger files use the documented SQL path.
export const MAX_BACKUP_BYTES=400_000_000;
async function request<T>(path:string,body:unknown):Promise<T>{const response=await fetch('/api/'+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as T&{error?:string};if(!response.ok)throw new Error(result.error??'Falha na operação de backup.');return result;}
export async function exportExistence(){const manifest=await request<Manifest>('backup/begin',{});const segments:Segment[]=[];try{for(const table of Object.keys(manifest.upper)){let after=0;do{const page=await request<Segment>('backup/page',{id:manifest.id,table,after});segments.push(page);after=page.next??0;}while(after);}const seal=await request<{headers:Header[]}>('backup/seal',{id:manifest.id});return new Blob([JSON.stringify({format:'bunborn',version:2,manifest,segments,seal})],{type:'application/json'});}catch(e){await request('backup/cancel',{id:manifest.id}).catch(()=>undefined);throw e;}}
export async function restoreExistence(file:File){if(file.size>MAX_BACKUP_BYTES)throw new Error('Backup acima de 400 MB: use a recuperação SQL documentada.');const backup=JSON.parse(await file.text()) as {version?:number;manifest?:Manifest;segments?:Segment[];seal?:{headers?:Header[]}};if(backup.version!==2)return request('restore',backup);if(!backup.manifest||!Array.isArray(backup.segments)||!Array.isArray(backup.seal?.headers))throw new Error('Backup incompleto.');
 const session=await request<{id:string;status:string}>('backup/restore/begin',{manifest:backup.manifest,seal:backup.seal});if(session.status==='complete')return {restored:true};
 // Upload by signed header position; a re-run of the same file resumes idempotently.
 const byKey=new Map(backup.segments.map(s=>[s.table+':'+s.after,s]));
 for(const [idx,header] of backup.seal!.headers!.entries()){const segment=byKey.get(header.table+':'+header.after);if(!segment)throw new Error('Segmento ausente no arquivo.');await request('backup/restore/page',{id:session.id,idx,rows:segment.rows});}
 for(let i=0;i<20000;i++){const result=await request<{complete:boolean}>('backup/restore/apply',{id:session.id});if(result.complete)return {restored:true};}throw new Error('Restauração em andamento; retome o mesmo arquivo para continuar.');}
