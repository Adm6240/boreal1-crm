import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import CFB from 'cfb';
export const pdf=Buffer.from('%PDF-1.4\nFixture de proposta Boreal\n%%EOF');
export const signature=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=','base64');
export function eml(id='fixture-1'){
  return Buffer.from([
    'From: Consultor <consultor@example.test>','To: Compras <compras@example.test>','Cc: Coordenador <coord@example.test>',
    'Subject: =?UTF-8?B?UHJvcG9zdGEg4oCTIEp1w61uYQ==?=',`Message-ID: <${id}@example.test>`,'Date: Wed, 23 Sep 2026 15:00:00 -0300','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="outer"','',
    '--outer','Content-Type: multipart/related; boundary="related"','',
    '--related','Content-Type: multipart/alternative; boundary="alternative"','',
    '--alternative','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',Buffer.from('Prezados, segue nossa proposta de impressão.').toString('base64'),
    '--alternative','Content-Type: text/html; charset=utf-8','Content-Transfer-Encoding: base64','',Buffer.from('<p>Prezados, segue nossa <b>proposta</b>.</p><img src="cid:signature"><script>window.injected=true</script><img src="https://tracking.invalid/pixel">').toString('base64'),'--alternative--',
    '--related','Content-Type: image/png','Content-ID: <signature>','Content-Disposition: inline; filename="assinatura.png"','Content-Transfer-Encoding: base64','',signature.toString('base64'),'--related--',
    '--outer','Content-Type: application/pdf','Content-Disposition: attachment; filename="Proposta.pdf"','Content-Transfer-Encoding: base64','',pdf.toString('base64'),'--outer--',''
  ].join('\r\n'));
}
export function msg(){
  const cfb=CFB.utils.cfb_new();
  const add=(name,content)=>CFB.utils.cfb_add(cfb,name,content);
  const unicode=(name,content)=>add(name,Buffer.from(content+'\0','utf16le'));
  unicode('__substg1.0_0037001F','Proposta – Juína');unicode('__substg1.0_1000001F','Prezados, segue nossa proposta de impressão.');
  unicode('__substg1.0_0C1A001F','Consultor');unicode('__substg1.0_5D01001F','consultor@example.test');unicode('__substg1.0_1035001F','<fixture-msg@example.test>');
  add('__substg1.0_10130102',Buffer.from('<p>Proposta</p><img src="cid:signature">'));
  const props=Buffer.alloc(48);props.writeUInt32LE(0x00390040,32);props.writeBigUInt64LE((BigInt(Date.parse('2026-09-23T18:00:00Z'))+11644473600000n)*10000n,40);add('__properties_version1.0',props);
  for(const [index,kind,name,email] of [[0,1,'Compras','compras@example.test'],[1,2,'Coordenador','coord@example.test'],[2,3,'Cópia oculta','private@example.test']]){
    const base=`__recip_version1.0_#${String(index).padStart(8,'0')}/`;
    unicode(base+'__substg1.0_3001001F',name);unicode(base+'__substg1.0_3003001F',email);unicode(base+'__substg1.0_39FE001F',email);
    const p=Buffer.alloc(24);p.writeUInt32LE(0x0c150003,8);p.writeUInt32LE(kind,16);add(base+'__properties_version1.0',p);
  }
  for(const [index,name,type,content,cid] of [[0,'Proposta.pdf','application/pdf',pdf,null],[1,'assinatura.png','image/png',signature,'signature']]){
    const base=`__attach_version1.0_#${String(index).padStart(8,'0')}/`;
    unicode(base+'__substg1.0_3707001F',name);unicode(base+'__substg1.0_370E001F',type);add(base+'__substg1.0_37010102',content);if(cid)unicode(base+'__substg1.0_3712001F',cid);
    const p=Buffer.alloc(24);p.writeUInt32LE(0x37050003,8);p.writeUInt32LE(1,16);add(base+'__properties_version1.0',p);
  }
  return CFB.write(cfb,{type:'buffer'});
}
export const arrayBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
export function environment({emptyUsers=false}={}){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');for(const filename of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
  if(!emptyUsers){sqlite.prepare("INSERT INTO app_users (id,email,name,role,consultant_name,active,must_change_password,password_hash,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?,?,?)").run('11111111-1111-4111-8111-111111111111','admin@example.invalid','Administrador Exemplo','admin','Danielle','fixture-unused-hash','fixture','2026-01-01','2026-01-01');sqlite.prepare('INSERT INTO app_sessions VALUES (?,?,?)').run(createHash('sha256').update('fixture-admin-session').digest('hex'),'11111111-1111-4111-8111-111111111111',Date.now()+3600000);}
  const prepared=(sql,args=[])=>({bind(...next){return prepared(sql,next)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const statement=sqlite.prepare(sql);return statement.columns().length?{results:statement.all(...args)}:statement.run(...args)}});
  const objects=new Map();
  return {DB:{prepare:prepared,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},BUCKET:{async put(key,data,metadata){objects.set(key,{bytes:new Uint8Array(data),metadata});},async get(key){const item=objects.get(key);return item?{body:item.bytes,size:item.bytes.byteLength}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}},objects,sqlite};
}
export function request(path,options={}){const headers=new Headers(options.headers || {});headers.set('cookie','__Host-boreal-session=fixture-admin-session');headers.set('oai-authenticated-user-id','authorized-test-user');headers.set('oai-authenticated-user-email','admin@example.invalid');return new Request('https://boreal.test'+path,{...options,headers});}
export function upload(file,filename='mensagem.eml',client='Cliente de teste',state='MG'){const body=new FormData();body.append('email',new Blob([file]),filename);body.append('project','Projeto de teste');return request('/api/client-history/import?'+new URLSearchParams({client,state}),{method:'POST',body});}
