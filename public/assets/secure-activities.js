(() => {
 'use strict';
 const testing=location.hostname==='boreal.test',legacyKey='boreal-activities-v1';
 let revision=0,loaded=false,queue=Promise.resolve(),failure=null,pending=null,cacheKey=null,epoch=null;
 const key=user=>'boreal-pending-activities:'+user.id;
 async function api(method,body){const r=await fetch('/api/activities',{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível salvar suas atividades.');return data;}
 const encode=bytes=>btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join(''));
 const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 async function encrypt(records){const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=new TextEncoder().encode(JSON.stringify(records));return JSON.stringify({iv:encode(iv),cipher:encode(await crypto.subtle.encrypt({name:'AES-GCM',iv},cacheKey,bytes))});}
 async function decrypt(stored){const data=JSON.parse(stored);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(data.iv)},cacheKey,decode(data.cipher))));}
 function refresh(){renderActivities();window.BorealSyncPipeline?.(activityRecords);renderKanban();renderDashboard();}
 function persist(records){
  if(!loaded){toast('Aguarde o carregamento das suas atividades antes de editar.');return;}
  const user=BorealAuth.user;if(!user)return;
  pending=structuredClone(records);
  const snapshot=structuredClone(pending);
  queue=queue.catch(()=>{}).then(async()=>{
   try{sessionStorage.setItem(key(user),await encrypt(snapshot));const result=await api('PUT',{revision,records:snapshot,epoch});revision=result.revision;failure=null;if(JSON.stringify(pending)===JSON.stringify(snapshot)){pending=null;sessionStorage.removeItem(key(user));}}
   catch(e){failure=e;toast(e.message+' Suas alterações permanecem nesta aba.');throw e;}
  });
  queue.catch(()=>{});
 }
 window.BorealPersistLocal=records=>{if(testing)localStorage.setItem(legacyKey,JSON.stringify(records));persist(records);};
 window.BorealFlushActivities=async()=>{await queue;if(pending){if(failure)throw failure;throw new Error('Há atividades não salvas. Aguarde antes de sair.');}};
 window.BorealClearActivities=()=>{const user=BorealAuth.user;if(user)sessionStorage.removeItem(key(user));activityRecords=[];window.BorealClients?.clear?.();refresh();};
 window.BorealActivitiesReady=BorealAuth.ready.then(async user=>{
  if(!['admin','coordinator','commercial'].includes(user.role)){loaded=true;activityRecords=[];refresh();return;}
  try{
   const data=await api('GET');revision=data.revision;epoch=data.epoch||null;cacheKey=await crypto.subtle.importKey('raw',Uint8Array.from(data.cacheKey.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
   if(epoch){const previous=localStorage.getItem('boreal-crm-epoch:'+user.id);if(previous!==epoch){localStorage.removeItem(legacyKey);sessionStorage.removeItem(key(user));localStorage.setItem('boreal-crm-epoch:'+user.id,epoch);}}
   let legacy=[];try{legacy=JSON.parse(localStorage.getItem(legacyKey)||'[]');}catch{}
   if(testing&&!epoch&&!legacy.length)legacy=activityRecords.filter(r=>!r.importRecordId);
   if(!Array.isArray(legacy))legacy=[];
   const norm=v=>String(v||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
   if(user.role==='commercial')legacy=legacy.filter(r=>norm(r.owner)===norm(user.consultantName)||norm(r.owner)===norm(user.name));
   const records=data.records.slice(),ids=new Set(records.map(r=>r.id));
   for(const r of legacy){if(!ids.has(r.id)&&typeof r.subject==='string'&&typeof r.client==='string'){records.push({...r,priority:['Normal','Alta','Urgente'].includes(r.priority)?r.priority:'Normal'});ids.add(r.id);}}
   let recovered;try{const stored=sessionStorage.getItem(key(user));if(stored)recovered=await decrypt(stored);}catch{sessionStorage.removeItem(key(user));toast('O rascunho local não pôde ser recuperado. A versão salva no servidor foi preservada.');}
   activityRecords=activityRecords.filter(r=>r.importRecordId).concat(Array.isArray(recovered)?recovered:records);
   loaded=true;refresh();
   if(legacy.length||recovered){persist(activityRecords.filter(r=>!r.importRecordId));await window.BorealFlushActivities();}
   // Only administrators migrate all legacy owners; never discard another user's old records.
   if(user.role!=='commercial'||legacy.length===JSON.parse(localStorage.getItem(legacyKey)||'[]').length){if(!testing)localStorage.removeItem(legacyKey);}
  }catch(e){failure=e;toast('Não foi possível carregar as atividades: '+e.message);}
 });
})();
