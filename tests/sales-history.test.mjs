import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import {environment,request} from './helpers.mjs';
import worker from '../server/index.mjs';
import {previewSalesHistory,applySalesHistory} from '../server/sales-history.mjs';
import {listGoalActuals} from '../server/orders.mjs';
const admin={role:'admin',authId:'11111111-1111-4111-8111-111111111111'};
const body=data=>new Request('https://boreal.test/api/sales-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const fixture=()=>{const env=environment();env.sqlite.prepare('INSERT INTO goal_settings (year,payload,updated_by,updated_at) VALUES (?,?,?,?)').run(2026,JSON.stringify({annual:{Felipe:0,Nicholas:1280000,Talita:1280000,Viviane:2000000}}),'test','2026-01-01');return env;};
test('Historical sales parser preserves blank months, zero sales and totals from the supplied layout',()=>{
 const window={};runInNewContext(fs.readFileSync('public/assets/sales-history-parser.js','utf8'),{window});
 const parsed=window.BorealSalesHistoryParser.parse([['Time Comercial 2026'],['','Felipe','Nicholas','Talita','Viviane','Meta geral'],['Referência:','-',1280000,1280000,2000000],['Janeiro',0,7710,35690,490231,533631],['Fevereiro',15751,218430.94,5757,102400.02],['Março',19939,345379,47610,375699.51],['Abril',396,21327.75,9048,147909.01],['Maio',45350,83756.25,400,85232.94],['Junho ',218354.4,117558,119044.92,309566.58],['Julho',74600,155670.15,29492.76,220418.33],['Agosto',20077,74082.2,4685,72969],['Setembro',143066,78799.37,209284.78,235519],['Outubro',null,null,null,null,0],['Novembro'],['Dezembro'],['Vendas:',537533.4,1102713.66,461012.46,2039945.39,4141204.91]]);
 assert.equal(parsed.year,2026);assert.equal(parsed.records.length,36);assert.equal(parsed.records[0].amount,0);assert.ok(parsed.records.every(row=>row.month<=9));
 const totals=Object.fromEntries(parsed.sellers.map(name=>[name,parsed.records.filter(row=>row.source===name).reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100]));assert.deepEqual(totals,{Felipe:537533.4,Nicholas:1102713.66,Talita:461012.46,Viviane:2039945.39});
});
test('Historical sales require admin, preview without writes and reimport replaces instead of duplicating',async()=>{
 const env=fixture(),data={year:2026,filename:'Metas 2026.xlsx',rows:[{consultant:'Felipe',month:1,amount:0},{consultant:'Nicholas',month:9,amount:78799.37}]};
 await assert.rejects(previewSalesHistory(body(data),env,{role:'commercial'}),error=>error.status===403);
 const preview=await previewSalesHistory(body(data),env,admin);assert.equal(preview.total,78799.37);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM sales_history').get().n,0);
 await applySalesHistory(body(data),env,admin);await applySalesHistory(body(data),env,admin);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM sales_history').get().n,2);
 await applySalesHistory(body({...data,rows:[{consultant:'Nicholas',month:9,amount:80000}]}),env,admin);assert.equal((await listGoalActuals(env,2026)).monthly.Nicholas[8],80000);
 await assert.rejects(applySalesHistory(body({...data,rows:[...data.rows,{consultant:'Unknown',month:10,amount:5}]}),env,admin));assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM sales_history').get().n,2);
 const denied=await worker.fetch(request('/api/sales-history/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,rows:[...data.rows,data.rows[0]]})}),env);assert.equal((await denied.json()).issues.length,1);
});
test('Homologated months override overlapping orders and subsequent system sales add to the same consultant',async()=>{
 const env=fixture();await applySalesHistory(body({year:2026,filename:'Metas.xlsx',rows:[{consultant:'Nicholas',month:9,amount:78799.37}]}),env,admin);
 env.sqlite.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?)').run('c','MG|client','Client','MG','route','2026-01-01');
 const insert=env.sqlite.prepare("INSERT INTO client_orders (id,client_id,project_key,payload,status,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,?,'generated',1,?,?,?,?)");
 for(const [id,created,value] of [['old','2026-10-01T01:00:00Z',500],['new','2026-10-02T12:00:00Z',1500.25]])insert.run(id,'c',id,JSON.stringify({movement:'Venda',orderValue:value,snapshot:{consultant:'nicholas'}}),'test','test',created,created);
 const result=await listGoalActuals(env,2026);assert.equal(result.monthly.Nicholas[8],78799.37);assert.equal(result.monthly.Nicholas[9],1500.25);assert.equal(result.orderCount,1);assert.equal(result.coveredOrderCount,1);assert.equal(result.historicalMonthCount,1);assert.equal(Object.keys(result.monthly).length,1);
});

test('Retired test goal is removed durably without touching the real Felipe or homologated sales',async()=>{
 const env=environment(),{readGoalSettings,saveGoalSettings}=await import('../server/goals-settings.mjs'),{salesHistory}=await import('../server/sales-history.mjs');
 const original={year:2026,generalTarget:4560000,superPercent:130,generalBonusPercent:100,superBonusPercent:200,annual:{'CONSULTOR DESATIVADO':2160000,'Consultor Exemplo':500000,Nicholas:1280000,Danielle:1440000}};
 env.sqlite.prepare('INSERT INTO goal_settings (year,payload,updated_by,updated_at) VALUES (?,?,?,?)').run(2026,JSON.stringify(original),'test','2026-01-01');
 assert.ok(!(await salesHistory(env,admin)).consultants.includes('CONSULTOR DESATIVADO'));
 await applySalesHistory(body({year:2026,filename:'Metas.xlsx',rows:[{consultant:'Consultor Exemplo',month:9,amount:143066}]}),env,admin);
 const read=await readGoalSettings(env,admin);assert.equal(read.settings.annual['CONSULTOR DESATIVADO'],undefined);assert.equal(read.settings.annual['Consultor Exemplo'],500000);assert.equal(read.settings.generalTarget,4560000);
 assert.equal(JSON.parse(env.sqlite.prepare('SELECT payload FROM goal_settings').get().payload).annual['CONSULTOR DESATIVADO'],undefined);
 const saved=await saveGoalSettings(body(original),env,admin);assert.equal(saved.settings.annual['CONSULTOR DESATIVADO'],undefined);
 assert.equal((await listGoalActuals(env,2026)).monthly['Consultor Exemplo'][8],143066);
});
