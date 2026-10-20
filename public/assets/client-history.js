(() => {
  'use strict';
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sameClient=(a,b)=>window.BorealActivityIdentity.same(a,b);
  const key=r=>`${r.state}|${r.client}`;
  const query=r=>new URLSearchParams({client:r.client,state:r.state}).toString();
  const bytes=value=>value<1048576?`${(value/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB`:`${(value/1048576).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
  const formatDate=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Data de envio não informada';
  const localDate=value=>{const parts=String(value).split('/');return parts.length===3?`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`:value;};
  let active=null,requestVersion=0,controller=null,emails=new Map(),orders=[],uploading=false,hasMore=false,nextOffset=0;
  const input=document.getElementById('historyEmailFile');
  const status=document.getElementById('historyEmailStatus');
  const addButton=document.getElementById('historyAddEmail');
  const copyButton=document.getElementById('historyCopyAddress');
  const orderStatus=document.createElement('p');orderStatus.id='historyOrderStatus';orderStatus.className='history-order-status';orderStatus.setAttribute('role','status');orderStatus.hidden=true;document.getElementById('detailTimeline').before(orderStatus);

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options});
    let data;try{data=await response.json();}catch{throw new Error('Entre novamente no Boreal para acessar o histórico.');}
    if(!response.ok)throw new Error(data.error || 'Não foi possível carregar o histórico.');return data;
  }
  function noteEvents(record){
    const records=typeof activityRecords!=='undefined'?activityRecords.filter(a=>sameClient(a,record)):[record];
    if(!records.length)records.push(record);
    const seen=new Set(),events=[];
    for(const r of records){for(const n of r.notes || []){const id=[n.date,n.author,n.text,JSON.stringify(n.segments||[])].join('|');if(seen.has(id))continue;seen.add(id);events.push({date:localDate(n.date),html:`<article class="history-entry history-note"><span class="history-symbol" aria-hidden="true">▤</span><div class="history-card"><header><b>Anotação</b><time>${escape(n.date)}</time></header><p>${window.BorealNotes?.render(n)||escape(n.text)}</p><small>${escape(n.author)}</small></div></article>`});}
      if(r.completed)events.push({date:r.date+'T'+(r.time || '12:00'),html:`<article class="history-entry"><span class="history-symbol" aria-hidden="true">✓</span><div class="history-card"><header><b>Atividade concluída</b><time>${escape(formatDate(r.date+'T'+(r.time || '12:00')))}</time></header><p>${escape(r.subject)}</p><small>${escape(r.owner)}</small></div></article>`});}
    return events;
  }
  function attachmentHtml(a){const url=`/api/client-history/files/${a.id}`;const viewable=/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(a.contentType);return `<div class="history-attachment"><span class="history-file-type">${escape(a.name.split('.').pop()?.slice(0,5).toUpperCase() || 'ARQ')}</span><div><b>${escape(a.name)}</b><small>${bytes(a.size)}</small></div><div class="history-file-actions">${viewable?`<a href="${url}?inline=1" target="_blank" rel="noopener">Abrir</a>`:''}<a href="${url}" download>Baixar</a></div></div>`;}
  function emailEvent(email){
    const visibleAttachments=email.attachments.filter(a=>!a.inline);
    const date=email.date || email.recordedAt;
    return {date,html:`<article class="history-entry history-email"><span class="history-symbol" aria-hidden="true">✉</span><details class="history-card" data-email-id="${email.id}"><summary><div><div class="history-email-title"><b>${escape(email.subject)}</b><span class="history-label">E-mail</span></div><div class="history-meta"><time>${escape(formatDate(email.date))}</time><span>${escape(email.from)} → ${escape(email.to.join(', '))}</span></div><p class="history-preview">${escape(email.text.replace(/\s+/g,' ').slice(0,190) || 'Abrir mensagem completa')}</p><div class="history-email-footer"><span>${visibleAttachments.length?`${visibleAttachments.length} ${visibleAttachments.length===1?'anexo':'anexos'}`:'Sem anexos'}${email.project?' · '+escape(email.project):''}</span><span class="history-expand">Ver mensagem</span></div></div><span class="history-chevron" aria-hidden="true">⌄</span></summary><div class="history-email-content"><dl><dt>De</dt><dd>${escape(email.from)}</dd><dt>Para</dt><dd>${escape(email.to.join(', '))}</dd>${email.cc.length?`<dt>Cc</dt><dd>${escape(email.cc.join(', '))}</dd>`:''}</dl><div class="history-message"><pre>${escape(email.text || 'Carregando mensagem…')}</pre></div>${email.attachments.length?`<div class="history-attachments"><b>Anexos</b>${visibleAttachments.map(attachmentHtml).join('')}${email.attachments.some(a=>a.inline)?`<details class="history-inline-files"><summary>Imagens da mensagem (${email.attachments.filter(a=>a.inline).length})</summary>${email.attachments.filter(a=>a.inline).map(attachmentHtml).join('')}</details>`:''}</div>`:''}<footer><span>${email.source==='bcc'?'Recebido por cópia de acompanhamento':'Adicionado do Outlook'} · ${escape(formatDate(email.recordedAt))}</span><a href="/api/client-history/original/${email.id}" download>Baixar e-mail original</a></footer></div></details></article>`};
  }
  function draw(record,items){
    const events=[...noteEvents(record),...items.map(emailEvent),...(window.BorealOrders?.events(orders)||[])].sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
    document.getElementById('detailTimeline').innerHTML=(events.map(e=>e.html).join('') || '<div class="history-empty"><b>Histórico ainda vazio</b><span>As anotações, atividades concluídas, pedidos e e-mails deste cliente aparecerão aqui.</span></div>')+(hasMore?'<button type="button" class="secondary" id="historyLoadMore">Carregar e-mails anteriores</button>':'');
    document.getElementById('historyLoadMore')?.addEventListener('click',async event=>{const version=requestVersion;event.currentTarget.disabled=true;try{const data=await api(`/api/client-history?${query(record)}&offset=${nextOffset}`);if(version!==requestVersion)return;for(const email of data.emails)emails.set(email.id,email);hasMore=data.hasMore;nextOffset=data.nextOffset;draw(record,[...emails.values()]);}catch(error){status.classList.add('error');status.textContent=error.message;document.getElementById('historyLoadMore')?.removeAttribute('disabled');}});
    document.querySelectorAll('#detailTimeline [data-email-id]').forEach(details=>details.addEventListener('toggle',()=>{
      details.querySelector('.history-expand').textContent=details.open?'Recolher':'Ver mensagem';
      if(details.open && !details.dataset.loaded){details.dataset.loaded='true';loadBody(details,emails.get(details.dataset.emailId));}
    }));
  }
  const toDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  async function loadBody(details,email){
    if(!email)return;
    const container=details.querySelector('.history-message');
    try{
      email=await api(`/api/client-history/messages/${email.id}`);
      const text=document.createElement('pre');text.textContent=email.text || 'A mensagem contém somente conteúdo formatado.';container.replaceChildren(text);
      if(!email.html || !window.DOMPurify)return;
      const sanitized=DOMPurify.sanitize(email.html,{USE_PROFILES:{html:true},FORBID_TAGS:['form','input','button','textarea','select','iframe','object','embed','link','meta','base','video','audio','source'],FORBID_ATTR:['srcset','formaction','ping']});
      const fragment=new DOMParser().parseFromString(sanitized,'text/html');
      fragment.querySelectorAll('a').forEach(a=>{a.removeAttribute('href');a.removeAttribute('target');});
      for(const img of fragment.querySelectorAll('img')){
        const src=img.getAttribute('src') || '';
        const cid=src.startsWith('cid:')?src.slice(4).replace(/^<|>$/g,''):null;
        const attachment=cid && email.attachments.find(a=>a.contentId?.replace(/^<|>$/g,'')===cid && /^image\/(png|jpeg|gif|webp)$/.test(a.contentType) && a.size<=2*1024*1024);
        if(attachment){const response=await fetch(`/api/client-history/files/${attachment.id}`,{credentials:'same-origin'});if(response.ok)img.setAttribute('src',await toDataUrl(await response.blob()));else img.removeAttribute('src');}
        else if(!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src))img.removeAttribute('src');
        img.removeAttribute('srcset');
      }
      const frame=document.createElement('iframe');frame.className='history-message-frame';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.title=`Mensagem: ${email.subject}`;
      frame.srcdoc=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:12px;font:16px/1.55 Arial,sans-serif;color:#23344c;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${fragment.body.innerHTML}</body></html>`;
      container.replaceChildren(frame);
    }catch(error){const warning=document.createElement('p');warning.className='history-status error';warning.textContent='Não foi possível carregar a mensagem completa. Recolha e abra novamente para tentar outra vez.';container.appendChild(warning);delete details.dataset.loaded;}
  }
  async function loadOrders(record,version,signal){
    orderStatus.hidden=true;
    try{const data=await api(`/api/client-orders?${query(record)}`,{signal});if(version!==requestVersion)return;orders=data.orders;draw(record,[...emails.values()]);}
    catch(error){if(error.name==='AbortError' || version!==requestVersion)return;orderStatus.hidden=false;orderStatus.textContent='Não foi possível carregar os pedidos. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Tentar novamente';retry.onclick=()=>loadOrders(record,version,signal);orderStatus.appendChild(retry);}
  }
  async function render(record){
    active=record;const version=++requestVersion;controller?.abort();controller=new AbortController();emails=new Map();orders=[];hasMore=false;nextOffset=0;draw(record,[]);loadOrders(record,version,controller.signal);
    status.classList.remove('error');status.textContent='Carregando e-mails do cliente…';copyButton.hidden=true;
    try{const data=await api(`/api/client-history?${query(record)}`,{signal:controller.signal});if(version!==requestVersion)return;emails=new Map(data.emails.map(e=>[e.id,e]));hasMore=data.hasMore;nextOffset=data.nextOffset;draw(record,data.emails);copyButton.hidden=!data.inbound.enabled;copyButton.dataset.address=data.inbound.address || '';status.textContent=data.inbound.enabled?'Endereço de acompanhamento disponível para copiar em Cco.':'Recebimento por Cco aguardando configuração. Você já pode adicionar um e-mail salvo no Outlook (.eml ou .msg, até 10 MB).';}
    catch(error){if(error.name==='AbortError' || version!==requestVersion)return;status.classList.add('error');status.textContent=error.message;}
  }
  addButton.addEventListener('click',()=>{if(active && !uploading)input.click();});
  input.addEventListener('change',async()=>{
    const file=input.files?.[0],record=active;input.value='';if(!file || !record)return;
    if(!/\.(eml|msg)$/i.test(file.name) || file.size>10*1024*1024){status.classList.add('error');status.textContent='Selecione um arquivo .eml ou .msg de até 10 MB.';return;}
    uploading=true;addButton.disabled=true;status.classList.remove('error');status.textContent='Registrando mensagem e anexos…';
    try{const form=new FormData();form.append('email',file);form.append('project',record.historyProject ?? record.project ?? '');const result=await api(`/api/client-history/import?${query(record)}`,{method:'POST',body:form});if(active && key(active)===key(record))await render(record);toast(result.duplicate?'Este e-mail já está no histórico do cliente.':`E-mail e anexos registrados para ${record.client}.`);}
    catch(error){if(active && key(active)===key(record)){status.classList.add('error');status.textContent=error.message;}}
    finally{uploading=false;addButton.disabled=false;}
  });
  copyButton.addEventListener('click',async()=>{const record=active;if(!record)return;try{let address=copyButton.dataset.address;if(!address){const result=await api(`/api/client-history/address?${query(record)}`,{method:'POST'});address=result.address;}await navigator.clipboard.writeText(address);toast('Endereço copiado. Cole no campo Cco do Outlook.');}catch(error){status.classList.add('error');status.textContent=error.message;}});
  window.BorealHistory={render};
  window.openClientHistory=name=>{
    const record=activityRecords.find(r=>r.client===name);
    if(record){openActivityDetail({...record,historyProject:''});return;}
    const c=clients.find(c=>c[0]===name);if(!c)return;
    openActivityDetail({id:null,client:name,project:'Histórico do cliente',historyProject:'',organization:name,contact:c[2],state:c[3],segment:c[1],stage:c[5],owner:'Danielle',value:0,email:'',phone:'',notes:[],date:isoWithOffset(0),time:'',type:'Tarefa',subject:'Acompanhamento do cliente',description:'Nenhuma atividade vinculada.'});
  };
})();
