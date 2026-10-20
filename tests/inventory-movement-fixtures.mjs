import {randomUUID} from 'node:crypto';
export function historyLine(env,{number='5947',client='Cliente de teste',date='2026-10-13',condition='used',part='Impressora',contact='Solicitante de teste',legacy=false,project='Testes',family='XM7-40'}={}){
 const batch='movement-fixture',id=randomUUID(),itemId=[part,condition,family].join('-');
 env.sqlite.prepare("INSERT OR IGNORE INTO inventory_import_batches (id,fingerprint,filename,payload,status,revision,author_id,created_at) VALUES (?,?,?,'{}','applied',1,'fixture','2026-10-16')").run(batch,batch,'Estoque de teste.xlsx');
 env.sqlite.prepare('INSERT OR IGNORE INTO inventory_items (id,sku,name,kind,balance,minimum,created_at) VALUES (?,?,?,?,0,0,?)').run(itemId,itemId,part,part.startsWith('Impressora')?'equipment':'accessory','2026-10-16');
 env.sqlite.prepare("INSERT OR IGNORE INTO inventory_import_items VALUES (?,?,?,'ready',0,0,'Fixture',?,1)").run(itemId,itemId,batch,JSON.stringify({condition,equipment:family}));
 const payload={entry:0,exit:1,movement:'EMPRESTIMO',reference:number,client,project,consultant:'Consultor',sheet:'Planilha1',line:2,note:'',...(legacy?{raw:{contato:contact},original:{'22. CONTATO':contact}}:{contact})};
 env.sqlite.prepare("INSERT INTO inventory_import_lines VALUES (?,?,?,?,'accepted',?,?)").run(id,batch,itemId,id,date,JSON.stringify(payload));return id;
}
export function kitHistory(env,options={}){for(const part of ['Impressora','Bateria','Carregador','Cabo tipo C','Capa de proteção'])historyLine(env,{...options,part});}
