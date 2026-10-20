(() => {
 'use strict';
 BorealAuth.ready.then(async user=>{
  if(user.role!=='admin')return;
  const panel=document.createElement('form');panel.className='user-form';panel.innerHTML='<h3 class="wide">Acesso às carteiras de clientes</h3><label>Cliente<select name="client" required></select></label><label>Consultor<select name="consultant" required></select></label><button class="secondary" type="submit">Autorizar consultor</button><p class="wide" role="status">O consultor vê os clientes vinculados às suas atividades e pedidos, além das autorizações adicionais feitas aqui.</p>';
  document.getElementById('usersList').after(panel);
  try{await BorealClients.ready;const response=await fetch('/api/users'),data=await response.json();if(!response.ok)throw new Error(data.error);
   const search=document.createElement('input');search.placeholder='Pesquisar cliente';search.setAttribute('aria-label','Pesquisar cliente para autorizar');panel.elements.client.before(search);
   const fill=()=>{panel.elements.client.replaceChildren();for(const c of BorealClients.all().filter(c=>c.legalName.toLocaleLowerCase('pt-BR').includes(search.value.toLocaleLowerCase('pt-BR'))).slice(0,100))panel.elements.client.add(new Option(c.legalName,c.id));};search.oninput=fill;fill();
   for(const u of data.users.filter(u=>u.active&&u.role==='commercial'))panel.elements.consultant.add(new Option(u.name,u.id));
  }catch(e){panel.querySelector('[role="status"]').textContent=e.message;}
  panel.onsubmit=async event=>{event.preventDefault();const button=panel.querySelector('button');button.disabled=true;try{const r=await fetch('/api/clients/'+panel.elements.client.value+'/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:panel.elements.consultant.value,grant:true})}),d=await r.json();if(!r.ok)throw new Error(d.error);panel.querySelector('[role="status"]').textContent='Acesso autorizado. O consultor deve atualizar sua página.';}catch(e){panel.querySelector('[role="status"]').textContent=e.message;}finally{button.disabled=false;}};
 });
})();
