(()=>{
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const serialKey=v=>String(v).normalize('NFKC').replace(/\s+/g,'').toUpperCase();
 const aliases={equipment:['SERIALEQUIPAMENTO','SERIALDOEQUIPAMENTO','SNEQUIPAMENTO','SNEQUIP','SNIMPRESSORA'],seal:['LACRE','NUMEROLACRE'],battery:['SERIALBATERIA','SERIALDABATERIA','SNBATERIA'],charger:['SERIALCARREGADOR','SERIALDOCARREGADOR','SNCARREGADOR']};
 function parse(sheets){const result=[],seen=new Set(),seals=new Set();for(const sheet of sheets){let columns=null;for(const row of sheet.rows){if(!columns){const found={};for(const [kind,names] of Object.entries(aliases)){const i=row.values.findIndex(v=>names.includes(norm(v)));if(i>=0)found[kind]=i;}if(['equipment','battery','charger'].every(k=>found[k]!==undefined))columns=found;continue;}
 const r={sheet:sheet.name,line:row.line};for(const kind of Object.keys(aliases))r[kind]=String(row.values[columns[kind]]??'').trim();if(!r.equipment&&!r.battery&&!r.charger&&!r.seal)continue;
 if(r.seal&&!r.equipment)throw new Error(`${sheet.name}, linha ${row.line}: lacre sem equipamento.`);
 for(const kind of ['equipment','battery','charger'])if(r[kind]){if(/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(r[kind]))throw new Error(`${sheet.name}, linha ${row.line}: serial em notação científica. Formate como texto e informe o valor completo.`);const key=kind+'|'+serialKey(r[kind]);if(seen.has(key))throw new Error('Serial repetido no arquivo: '+r[kind]);seen.add(key);}
 if(r.seal){const key=serialKey(r.seal);if(seals.has(key))throw new Error('Lacre repetido no arquivo: '+r.seal);seals.add(key);}result.push(r);if(result.length>50000)throw new Error('Limite de 50.000 linhas por arquivo. Divida a planilha.');}
 }if(!result.length)throw new Error('Não foram encontrados dados com os cabeçalhos Serial Equipamento, Lacre, Serial Bateria e Serial Carregador.');return result;}
 globalThis.BorealSerialParser={parse,serialKey};
})();
