import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/assets/pipedrive-import-parser.js';
const parser=globalThis.BorealPipedriveParser;
test('Direct activity exports are recognized by columns without depending on Excel sheet names',()=>{
 const headers=['ID','Assunto','Concluído','Organização','ID da organização','Negócio','Atribuído a usuário','Data de vencimento'];
 for(const sheet of ['activity list','Planilha1','Atividades'])assert.equal(parser.kind(sheet,headers),'Atividades');
 assert.equal(parser.kind('Clientes',[]),'Clientes');assert.equal(parser.kind('Reatribuir',[]),'Atividades');assert.equal(parser.kind('Sem relação',['ID','Nome'] ),null);assert.equal(parser.kind('Dados',['atividade_id','assunto']),'Atividades');
});
test('Raw Pipedrive rows map IDs, owners, dates, organization, contact, project and notes without changing the source',()=>{
 const row={ID:'00103',Assunto:'Reunião','Tipo':'Reunião','Concluído':'Para fazer','Organização':'Cliente','ID da organização':'123','Pessoa de contato':'Compras','ID da pessoa de contato':'456','Negócio':'Projeto','ID do negócio':'789','Data de vencimento':'20/10/2026','Horário de vencimento':'09:30:00',Nota:'<div>Primeira linha</div><div>Segunda linha</div>','Atribuído a usuário':'Danielle','Prioridade':'Alta'};
 const result=parser.activity(row);assert.equal(result.importar,'SIM');assert.equal(result.atividade_id,'00103');assert.equal(result.cliente_id,'123');assert.equal(result.cliente_nome,'Cliente');assert.equal(result.negocio_titulo,'Projeto');assert.equal(result.responsavel_original,'Danielle');assert.equal(result.data_vencimento,'2026-10-20');assert.equal(result.hora_vencimento,'09:30');assert.equal(result.concluida,'NÃO');assert.equal(result.nota,row.Nota);assert.equal(row.importar,undefined);
 for(const status of ['Concluído','Sim','true',true,1])assert.equal(parser.activity({...row,'Concluído':status}).concluida,'SIM');
 assert.equal(parser.activity({...row,Negócio:'',Projeto:'Projeto separado'}).negocio_titulo,'Projeto separado');
 const incomplete=parser.activity({ID:1,Assunto:'Sem cliente','Data de vencimento':'2026-10-20'});assert.equal(incomplete.cliente_id,'');assert.equal(incomplete.cliente_nome,'');
});
test('Prepared Boreal rows preserve explicit exclusions, consultant mapping and normalized fields',()=>{
 const row={atividade_id:'A-1',assunto:'Retorno',importar:'REVISAR',consultor_destino:'Danielle',concluida:'NÃO'};assert.equal(parser.activity(row),row);assert.equal(parser.kind('ATIVEIDADES',Object.keys(row)),'Atividades');
});
