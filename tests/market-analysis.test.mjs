import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './helpers.mjs';
import {marketPreview,marketApply,marketComplete,marketHistory,marketData} from '../server/market-analysis.mjs';

const admin={role:'admin',authId:'11111111-1111-4111-8111-111111111111'};
const body=value=>new Request('https://boreal.test/api/market/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});

test('Registered CEMIG sale reads Zebra from equipment and quantity/model from last sale',async()=>{
 const {registeredSaleEquipment}=await import('../server/market-analysis.mjs');
 const profile={hasBought:'yes',equipment:'Zebra',lastSaleDescription:'1600 ZQ-521',lastSaleDate:'2025-08-25'};
 assert.deepEqual(registeredSaleEquipment(profile),[{brand:'Zebra',category:'Impressora móvel',description:'1600 ZQ-521',quantity:1600,deliveryDate:'2025-08-25',orderNumber:'',source:'Venda informada no cadastro'}]);
 assert.deepEqual(registeredSaleEquipment({...profile,hasBought:'no'}),[]);
 assert.deepEqual(registeredSaleEquipment({...profile,equipment:'Modelo não informado'}),[]);
 assert.equal(registeredSaleEquipment({...profile,equipment:'Zebra e Urovo'})[0].quantity,null,'Ambiguous brand quantities must not be invented');
 assert.equal(registeredSaleEquipment({...profile,equipment:'Zebra e Urovo',lastSaleDescription:'10 Zebra ZQ-521'})[0].quantity,10);
});

test('market import is admin-only and validates Brazilian UF and IBGE prefixes',async()=>{
  const env=environment(),valid={estado:'MG',codigo_ibge:'3106200',municipio:'Belo Horizonte',companhia:'Companhia A'};
  await assert.rejects(marketPreview(body({rows:[valid]}),env,{role:'commercial'}),error=>error.status===403);
  const preview=await marketPreview(body({rows:[valid,{...valid,estado:'SP',municipio:'São Paulo'},{...valid,estado:'XX'}]}),env,admin);
  assert.deepEqual(preview.counts,{rows:3,ready:1,issues:2,duplicates:0,updates:0,newRecords:1});
  assert.equal(env.sqlite.prepare('SELECT count(*) AS count FROM market_presence').get().count,0,'preview must not write data');
});

test('municipal market data keeps multiple companies and safely updates an existing relation',async()=>{
  const env=environment(),rows=[
    {estado:'MG',codigo_ibge:'3106200',municipio:'Belo Horizonte',companhia:'Companhia A',segmento:'Energia'},
    {estado:'MG',codigo_ibge:'3106200',municipio:'Belo Horizonte',companhia:'Companhia B',segmento:'Saneamento'}
  ];
  assert.equal((await marketApply(body({rows}),env,admin)).applied,2);
  let data=await marketData(env,admin,'MG');
  assert.equal(data.entries.length,2);assert.deepEqual(data.entries.map(item=>item.company),['Companhia A','Companhia B']);
  await marketApply(body({rows:[{...rows[0],segmento:'Distribuição'}]}),env,admin);
  data=await marketData(env,{role:'commercial'},'MG');
  assert.equal(data.entries.length,2);assert.equal(data.entries.find(item=>item.company==='Companhia A').sector,'Distribuição');
  await marketComplete(body({filename:'atuacao.xlsx',summary:{ready:2}}),env,admin);
  assert.equal((await marketHistory(env,admin)).batches[0].filename,'atuacao.xlsx');
});

test('Company import preserves seven-column data, first row and shared municipal service',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');const window={};
 runInNewContext(readFileSync('public/assets/company-import-parser.js','utf8'),{window});
 const matrix=[['Sudeste','Abadia dos Dourados','MG','Sociedade de economia mista','Regional','Companhia de Saneamento de Minas Gerais ','COPASA'],['Sudeste','Água Boa','MG','Empresa pública','Regional','COPASA Serviços de Saneamento Integrado','COPANOR'],['Sudeste','Água Boa','MG','Autarquia','Local','Serviço Autônomo de Água e Esgoto','SAAE']];
 const parsed=window.BorealCompanyParser.parse(matrix);assert.equal(parsed.rows.length,3);assert.equal(parsed.rows[0].municipio,'Abadia dos Dourados');assert.equal(parsed.rows[0].line,1);
 const env=environment(),preview=await marketPreview(body({rows:parsed.rows}),env,admin);
 assert.equal(preview.counts.ready,3);await marketApply(body({rows:preview.records}),env,admin);
 const data=await marketData(env,{role:'commercial'},'MG');assert.equal(data.entries.length,3);assert.equal(data.entries.filter(r=>r.municipality==='Água Boa').length,2);
 const copasa=data.entries.find(r=>r.acronym==='COPASA');assert.equal(copasa.legalNature,'Sociedade de economia mista');assert.equal(copasa.scope,'Regional');assert.equal(copasa.region,'Sudeste');assert.equal(copasa.sector,'Saneamento');
 await marketApply(body({rows:preview.records}),env,admin);assert.equal((await marketData(env,admin,'MG')).entries.length,3);
 const headers=window.BorealCompanyParser.parse([['Município','UF','Nome da companhia','Sigla','Natureza jurídica','Abrangência'],['Abadia dos Dourados','MG','Companhia de Saneamento de Minas Gerais','COPASA','Sociedade de economia mista','Regional']]);assert.equal(headers.rows[0].sigla,'COPASA');assert.equal(headers.rows[0].line,2);
});

test('Market matches company identities, rejects ambiguous acronyms and reflects purchases from saved profiles',async()=>{
 const {companyProfiles}=await import('../server/market-analysis.mjs');
 const profile={id:'copasa',legalName:'COPASA',tradeName:'Companhia de Saneamento de Minas Gerais',hasBought:'yes',equipment:'800 impressoras XM7-40',lastSaleDescription:'800 impressoras XM7-40',lastSaleDate:'2026-09-30'};
 const entries=[{company:'Companhia de Saneamento de Minas Gerais',acronym:'COPASA'},{company:'COPASA Serviços de Saneamento Integrado',acronym:'COPANOR'},{company:'Serviço A',acronym:'SAAE'}];
 let result=companyProfiles(entries,[profile,{id:'a',legalName:'Empresa A',tradeName:'SAAE',hasBought:'yes'},{id:'b',legalName:'Empresa B',tradeName:'SAAE',hasBought:'yes'}]);
 assert.equal(result[0].borealClient,true);assert.equal(result[0].client.equipment,'800 impressoras XM7-40');assert.equal(result[1].client,null);assert.equal(result[2].client,null);
 result=companyProfiles(entries,[{...profile,hasBought:'no'}]);assert.equal(result[0].borealClient,false);
 const env=environment();await marketApply(body({rows:[{estado:'MG',municipio:'Belo Horizonte',companhia:entries[0].company,sigla:'COPASA'}]}),env,admin);
 env.sqlite.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?)').run('copasa','copasa|mg','COPASA','MG','copasa-route','2026-01-01');
 env.sqlite.prepare('INSERT INTO client_profiles (id,payload,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,1,?,?,?,?)').run('copasa',JSON.stringify(profile),admin.authId,admin.authId,'2026-01-01','2026-01-01');
 const order={number:'PED-COPASA-1',delivery:{city:'Belo Horizonte',state:'MG'},items:[{kind:'equipment',brand:'Zebra',category:'Impressora móvel',description:'ZQ521',quantity:12}]};
 env.sqlite.prepare('INSERT INTO client_orders (id,client_id,project_key,payload,status,workflow,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('order-copasa','copasa','renovacao',JSON.stringify(order),'dispatched',JSON.stringify({events:[{status:'dispatched',at:'2026-10-18T10:00:00.000Z'}]}),1,admin.authId,admin.authId,'2026-10-18','2026-10-18');
 const data=await marketData(env,{role:'commercial'},'MG');assert.equal(data.entries[0].client.lastSaleDescription,'800 impressoras XM7-40');assert.equal(data.entries[0].borealClient,true);assert.deepEqual(data.equipmentByClient.copasa,[{brand:'Zebra',category:'Impressora móvel',description:'ZQ521',quantity:12,deliveryDate:'2026-10-18',orderNumber:'PED-COPASA-1',source:'Pedido despachado/concluído'}]);
});

test('National import validates all 27 UFs, keeps same-name cities separate and reimports without duplicates',async()=>{
 const fs=await import('node:fs'),{JSDOM}=await import('jsdom'),{runInNewContext}=await import('node:vm'),window={};runInNewContext(fs.readFileSync('public/assets/company-import-parser.js','utf8'),{window});const parser=window.BorealCompanyParser,rows=[];
 for(const uf of parser.states){const dom=new JSDOM(fs.readFileSync(`public/assets/municipal/${uf}.svg`,'utf8'),{contentType:'image/svg+xml'}),path=dom.window.document.querySelector('[data-city]');rows.push({estado:uf,municipio:path.dataset.city,codigo_ibge:path.dataset.code,companhia:'Companhia nacional'});dom.window.close();}
 rows.push({estado:'MG',municipio:'Água Boa',companhia:'Companhia compartilhada'},{estado:'MT',municipio:'Água Boa',companhia:'Companhia compartilhada'});
 const env=environment(),preview=await marketPreview(body({rows}),env,admin);assert.equal(preview.counts.ready,29);assert.equal(preview.counts.duplicates,0);await marketApply(body({rows:preview.records}),env,admin);
 const national=await marketData(env,admin,'BR');assert.equal(new Set(national.entries.map(row=>row.state)).size,27);assert.equal(national.entries.length,29);
 const repeated=await marketPreview(body({rows}),env,admin);assert.equal(repeated.counts.updates,29);assert.equal(repeated.counts.newRecords,0);assert.equal((await marketData(env,admin,'MT')).entries.filter(row=>row.municipality==='Água Boa').length,1);
 await marketComplete(body({filename:'Base Brasil.xlsx',summary:{ready:29,states:parser.states}}),env,admin);assert.equal((await marketHistory(env,admin)).batches[0].state,'BR');
 const first=parser.parse([['Norte','Alta Floresta D Oeste','RO','Autarquia','Local','Serviço de Água','SAAE']]);assert.equal(first.rows.length,1);assert.equal(first.rows[0].line,1);
 await assert.rejects(marketData(env,admin,'XX'),/UF válida/);
});

test('Shared local names and acronyms do not assign another municipality to a Boreal customer',async()=>{
 const {companyProfiles}=await import('../server/market-analysis.mjs'),entries=[{state:'MG',municipality:'Água Boa',company:'Serviço Autônomo de Água e Esgoto',acronym:'SAAE',scope:'Local'},{state:'MT',municipality:'Água Boa',company:'Serviço Autônomo de Água e Esgoto',acronym:'SAAE',scope:'Local'},{state:'SP',municipality:'São Paulo',company:'Outro Serviço',acronym:'SAAE',scope:'Local'}];
 const result=companyProfiles(entries,[{legalName:'Serviço Autônomo de Água e Esgoto',tradeName:'SAAE',state:'MG',delivery:{city:'Água Boa'},hasBought:'yes'}]);assert.deepEqual(result.map(row=>row.borealClient),[true,false,false]);
});
