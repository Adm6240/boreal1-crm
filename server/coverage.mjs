const categories=new Set(['Impressora móvel','Impressora de mesa','Coletor de dados','Outro equipamento']);
const knownBrands=['Bixolon','Zebra','Urovo'];

function brandFor(item){
  const supplied=String(item.brand||'').trim();
  const known=knownBrands.find(name=>new RegExp(`\\b${name}\\b`,'i').test(supplied||item.description||''));
  return known||supplied||'Não informada';
}

function categoryFor(item){
  if(categories.has(item.category))return item.category;
  const model=String(item.description||'').toUpperCase();
  if(/\b(?:XM7|SPP|ZQ[0-9]|RW[0-9])[-\w]*/.test(model))return 'Impressora móvel';
  if(/\b(?:XD[0-9]|SRP[0-9]|ZD[0-9]|ZT[0-9])[-\w]*/.test(model))return 'Impressora de mesa';
  if(/\b(?:TC[0-9]|MC[0-9]|CT[0-9]|DT[0-9]|RT[0-9]|ET[0-9])[-\w]*/.test(model))return 'Coletor de dados';
  return 'Outro equipamento';
}

export async function listCoverage(env){
  const rows=await env.DB.prepare("SELECT payload FROM client_orders WHERE status IN ('dispatched','completed')").all();
  const entries=[];
  for(const row of rows.results||[]){
    let order;try{order=JSON.parse(row.payload);}catch{continue;}
    const state=String(order.delivery?.state||'').toUpperCase(),city=String(order.delivery?.city||'').trim();
    if(!/^[A-Z]{2}$/.test(state)||!city||!Array.isArray(order.items))continue;
    for(const item of order.items){
      if(item.kind!=='equipment'||!Number.isSafeInteger(item.quantity)||item.quantity<1)continue;
      entries.push({state,city,brand:brandFor(item),category:categoryFor(item),quantity:item.quantity});
    }
  }
  return {entries};
}
