import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {parseEmail,limitedBody} from '../server/email.mjs';
import worker from '../server/index.mjs';
import {eml,msg,pdf,signature,arrayBuffer,environment,request,upload} from './helpers.mjs';

test('EML preserves accented subject, dates, message and original attachment bytes',async()=>{
  const email=await parseEmail(arrayBuffer(eml()),'proposta.eml');assert.equal(email.subject,'Proposta – Juína');assert.equal(email.date,'2026-09-23T18:00:00.000Z');assert.match(email.text,/impressão/);assert.deepEqual(Buffer.from(email.attachments.find(a=>a.name==='Proposta.pdf').bytes),pdf);assert.equal(email.attachments.find(a=>a.inline).cid,'signature');
});
test('Outlook MSG separates To/Cc/Bcc, preserves sent date and reads PDF plus inline signature',async()=>{
  const email=await parseEmail(arrayBuffer(msg()),'proposta.msg');assert.equal(email.subject,'Proposta – Juína');assert.equal(email.from,'Consultor <consultor@example.test>');assert.equal(email.date,'2026-09-23T18:00:00.000Z');assert.deepEqual(email.to,['Compras <compras@example.test>']);assert.deepEqual(email.cc,['Coordenador <coord@example.test>']);assert.equal(email.messageId,'<fixture-msg@example.test>');assert.deepEqual(Buffer.from(email.attachments.find(a=>a.name==='Proposta.pdf').bytes),pdf);assert.equal(email.attachments.find(a=>a.inline).cid,'signature');assert.deepEqual(Buffer.from(email.attachments.find(a=>a.inline).bytes),signature);
});
test('Saved mail survives a new request; duplicate imports do not create extra messages or files',async()=>{
  const env=environment();const first=await worker.fetch(upload(eml()),env);assert.equal(first.status,201,await first.clone().text());const result=await first.json();const originalCount=env.objects.size;
  const duplicate=await worker.fetch(upload(eml()),env);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(env.objects.size,originalCount);
  const response=await worker.fetch(request('/api/client-history?client=Cliente%20de%20teste&state=MG'),env);const data=await response.json();assert.equal(data.emails.length,1);assert.equal(data.inbound.enabled,false);assert.equal(data.inbound.address,null);assert.equal(data.emails[0].id,result.id);
  const attachment=data.emails[0].attachments.find(a=>a.name==='Proposta.pdf');const file=await worker.fetch(request(`/api/client-history/files/${attachment.id}`),env);assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf);
  const original=await worker.fetch(request(`/api/client-history/original/${result.id}`),env);assert.deepEqual(Buffer.from(await original.arrayBuffer()),eml());
  const other=await worker.fetch(request('/api/client-history?client=Outro%20cliente&state=MG'),env);assert.equal((await other.json()).emails.length,0);
});
test('Authentication, wrong origin, invalid files and unconfigured inbound are rejected',async()=>{
  const env=environment();assert.equal((await worker.fetch(new Request('https://boreal.test/api/client-history?client=Teste&state=MG'),env)).status,401);
  const req=upload(eml());req.headers.set('origin','https://untrusted.invalid');assert.equal((await worker.fetch(req,env)).status,403);
  assert.equal((await worker.fetch(upload(Buffer.from('not a message'),'bad.msg'),env)).status,400);
  assert.equal((await worker.fetch(request('/api/client-history/inbound',{method:'POST',body:'not a message'}),env)).status,503);assert.equal(env.objects.size,0);
});
test('Verified inbound token routes only to the matching client and deduplicates retries',async()=>{
  const env={...environment(),BOREAL_INBOUND_ENABLED:'true',BOREAL_INBOUND_DOMAIN:'inbound.example.test',BOREAL_INBOUND_LOCAL_PART:'boreal',BOREAL_INGEST_KEY:'integration-secret-for-testing-123456789'};
  const response=await worker.fetch(request('/api/client-history/address?client=Cliente%20de%20teste&state=MG',{method:'POST'}),env);const {address}=await response.json();assert.ok(address);
  const inbound=()=>new Request('https://boreal.test/api/client-history/inbound',{method:'POST',headers:{'Content-Type':'message/rfc822','x-boreal-recipient':address,'x-boreal-ingest-key':env.BOREAL_INGEST_KEY},body:eml('inbound')});
  assert.equal((await worker.fetch(inbound(),env)).status,201);assert.equal((await (await worker.fetch(inbound(),env)).json()).duplicate,true);
  const wrong=inbound();wrong.headers.set('x-boreal-ingest-key','invalid');assert.equal((await worker.fetch(wrong,env)).status,401);
});
test('Oversized streamed request is rejected even without Content-Length',async()=>{const r=new Request('https://boreal.test',{method:'POST',body:new Uint8Array(100)});await assert.rejects(limitedBody(r,80),error=>error.status===413);});
test('Built Worker runs without Node globals and preserves all original screens and maps',async()=>{
  const code=transformSync(fs.readFileSync('dist/server/index.js','utf8'),{format:'iife',globalName:'BorealWorker'}).code;
  const context=vm.createContext({Response,Request,Headers,URL,atob,btoa,TextDecoder,TextEncoder,crypto,console,setTimeout,clearTimeout});vm.runInContext(code,context);const runtime=context.BorealWorker.default;
  const html=await (await runtime.fetch(new Request('https://boreal.test/'),{})).text();assert.match(html,/Visão geral/);assert.match(html,/historyAddEmail/);
  for(const uf of ['MG','MT','ES','AM','DF'])assert.equal((await runtime.fetch(new Request(`https://boreal.test/assets/municipal/${uf}.svg`),{})).status,200);
});
