// Accept the prepared Boreal workbook and direct Pipedrive activity exports.
(function(root){
 const norm=value=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const aliases={atividade_id:['ID','ID da atividade'],assunto:['Assunto'],tipo:['Tipo'],concluida:['Concluído','Concluída'],cliente_id:['ID da organização','ID da organizacao'],cliente_nome:['Organização'],contato_nome:['Pessoa de contato'],contato_id:['ID da pessoa de contato'],negocio_titulo:['Negócio'],negocio_id:['ID do negócio'],data_vencimento:['Data de vencimento'],hora_vencimento:['Horário de vencimento'],nota:['Nota'],responsavel_original:['Atribuído a usuário'],prioridade:['Prioridade']};
 const text=v=>String(v??'').trim();
 function date(v){const value=text(v),br=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return br?`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`:value.slice(0,10);}
 function kind(name,headers=[]){const prepared={clientes:'Clientes',contatos:'Contatos',negocios:'Negócios',atividades:'Atividades',reatribuir:'Atividades'}[norm(name)];if(prepared)return prepared;const keys=new Set(headers.map(norm));if(keys.has('atividadeid')&&keys.has('assunto'))return 'Atividades';if((keys.has('id')||keys.has('iddaatividade'))&&keys.has('assunto')&&(keys.has('atribuidoausuario')||keys.has('datadevencimento')))return 'Atividades';return null;}
 function activity(row){if(Object.hasOwn(row,'atividade_id')||Object.hasOwn(row,'id_pipedrive_atividade'))return row;const source=new Map(Object.entries(row).map(([key,value])=>[norm(key),value]));if(!source.has('assunto')||!source.has('id')&&!source.has('iddaatividade'))return row;
 const result={importar:'SIM'};for(const [target,headers] of Object.entries(aliases)){const sourceKey=headers.map(norm).find(k=>source.has(k));result[target]=text(source.get(sourceKey));}
 const completed=norm(result.concluida);result.concluida=['sim','concluido','concluida','feito','true','1'].includes(completed)?'SIM':'NÃO';result.data_vencimento=date(result.data_vencimento);result.hora_vencimento=result.hora_vencimento.slice(0,5);
 result.negocio_titulo=result.negocio_titulo||text(source.get('projeto'));return result;
 }
 root.BorealPipedriveParser={kind,activity};
})(globalThis);
