const brNames={AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'};
const geoEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalizeCityName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
let geoEntries=[],geoLoaded=false,geoError='',geoLevel='BR',geoRenderVersion=0,geoLoadVersion=0;
const currentBrand=()=>document.getElementById('brandFilter').value;
const currentEquipment=()=>document.getElementById('equipmentFilter').value;
function filteredEquipment(state='Todos',brand=currentBrand()){
  return geoEntries.filter(entry=>(state==='Todos'||entry.state===state)&&(brand==='Todas'||entry.brand===brand)&&(currentEquipment()==='Todos'||entry.category===currentEquipment()));
}
const sumEquipment=entries=>entries.reduce((total,entry)=>total+entry.quantity,0);
const stateCount=uf=>sumEquipment(filteredEquipment(uf));
function colorFor(value,max){if(!value)return [231,236,243];const ratio=value/Math.max(1,max);return ratio>.7?[10,69,139]:ratio>.35?[47,125,205]:[139,187,235]}
function updateGeoKpis(){
  const state=document.getElementById('stateFilter').value,entries=filteredEquipment(state),states=new Set(entries.map(entry=>entry.state));
  document.getElementById('kpiClients').textContent=geoLoaded?sumEquipment(entries).toLocaleString('pt-BR'):'—';
  document.getElementById('kpiStates').textContent=geoLoaded?`${states.size} ${states.size===1?'estado com despacho':'estados com despacho'}`:'Cobertura indisponível';
}
function renderNationalSummary(){
  const entries=filteredEquipment(),covered=Object.keys(brNames).filter(uf=>stateCount(uf)>0),total=sumEquipment(entries),brands=[...new Set(entries.map(entry=>entry.brand))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  document.getElementById('stateDetail').innerHTML=`<div class="geo-summary-head"><div><p class="eyebrow">COBERTURA BRASIL</p><h3>${geoEscape(currentBrand()==='Todas'?'Todas as marcas':currentBrand())}</h3><p>Equipamentos dos pedidos despachados</p></div><span class="brand-pill">${covered.length}/27 UF</span></div><div class="coverage-score"><small>Equipamentos despachados</small><strong>${total.toLocaleString('pt-BR')}</strong></div><div class="state-numbers"><div><strong>${covered.length}</strong><span>estados atendidos</span></div><div><strong>${27-covered.length}</strong><span>estados sem despacho</span></div></div>${brands.length?`<div class="product-bars">${brands.map(brand=>{const count=sumEquipment(entries.filter(entry=>entry.brand===brand));return `<div class="product-bar"><header><b>${geoEscape(brand)}</b><span>${count.toLocaleString('pt-BR')}</span></header><i style="--w:${Math.round(count/Math.max(total,1)*100)}%"></i></div>`}).join('')}</div>`:'<p class="geo-no-orders">Nenhum pedido foi despachado com estes filtros.</p>'}`;
}
function showStateSummary(uf){
  document.querySelectorAll('[data-uf]').forEach(path=>path.classList.toggle('selected',path.dataset.uf===uf));
  const entries=filteredEquipment(uf),count=sumEquipment(entries),cities=new Map(),brands=new Map();
  for(const entry of entries){const cityKey=normalizeCityName(entry.city);const city=cities.get(cityKey)||{name:entry.city,count:0};city.count+=entry.quantity;cities.set(cityKey,city);brands.set(entry.brand,(brands.get(entry.brand)||0)+entry.quantity)}
  const rows=[...cities.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'pt-BR'));
  document.getElementById('stateFilter').value=uf;
  document.getElementById('stateDetail').innerHTML=`<div class="geo-summary-head"><div><p class="eyebrow">${uf} · COBERTURA ESTADUAL</p><h3>${brNames[uf]}</h3><p>${rows.length} ${rows.length===1?'município com despacho':'municípios com despacho'}</p></div><span class="brand-pill">${count.toLocaleString('pt-BR')} un.</span></div><div class="state-numbers">${[...brands].sort((a,b)=>b[1]-a[1]).map(([brand,quantity])=>`<div><strong>${quantity.toLocaleString('pt-BR')}</strong><span>${geoEscape(brand)}</span></div>`).join('')||'<div><strong>0</strong><span>equipamentos despachados</span></div>'}</div>${rows.length?`<table class="municipality-table"><tbody>${rows.map(city=>`<tr><td>${geoEscape(city.name)}</td><td>${city.count.toLocaleString('pt-BR')} equipamentos</td></tr>`).join('')}</tbody></table>`:'<p class="geo-no-orders">Nenhum pedido despachado neste estado com os filtros atuais.</p>'}<button class="primary" id="openStateMap" style="width:100%;margin-top:18px">Analisar municípios no mapa</button>`;
  document.getElementById('openStateMap').onclick=()=>renderStateMap(uf);
  updateGeoKpis();
}
function geoFailure(){
  document.getElementById('brazilMap').innerHTML='<div class="empty-state"><b>Não foi possível carregar a cobertura dos pedidos.</b><span>Confira a conexão e tente novamente.</span><button type="button" class="secondary" id="retryGeo">Tentar novamente</button></div>';
  document.getElementById('retryGeo').onclick=refreshGeo;
  document.getElementById('stateDetail').innerHTML='<p class="geo-no-orders">A cobertura está temporariamente indisponível.</p>';
  updateGeoKpis();
}
async function renderNational(){
  const version=++geoRenderVersion;geoLevel='BR';document.getElementById('stateFilter').value='Todos';document.getElementById('backToBrazil').hidden=true;
  document.getElementById('mapTitle').textContent='Cobertura nacional por equipamento';document.getElementById('mapSubtitle').textContent='Pedidos despachados por estado e município';document.querySelector('.territory-body').classList.remove('state-view');
  const host=document.getElementById('brazilMap');host.innerHTML='<div class="empty-state">Carregando mapa de cobertura…</div>';
  if(geoError){geoFailure();return;}
  const max=Math.max(1,...Object.keys(brNames).map(stateCount));
  try{
    const response=await fetch('assets/brazil-states.svg');if(!response.ok)throw new Error('map');const svg=await response.text();if(version!==geoRenderVersion)return;
    host.innerHTML=`<div class="vector-map">${svg}<div class="coverage-scale"><b>Equipamentos despachados</b><div class="scale-bar"></div><span>Sem despachos &nbsp;→&nbsp; Maior presença</span></div><div class="map-tooltip" id="mapTooltip"></div></div>`;
    host.querySelectorAll('[data-uf]').forEach(path=>{
      const uf=path.dataset.uf,count=stateCount(uf);path.style.fill=`rgb(${colorFor(count,max).join(',')})`;path.classList.toggle('no-coverage',!count);path.onclick=()=>showStateSummary(uf);
      path.onmousemove=event=>{const tooltip=document.getElementById('mapTooltip');tooltip.innerHTML=`<b>${brNames[uf]}</b><span>${count.toLocaleString('pt-BR')} equipamentos despachados</span>`;tooltip.style.left=(event.offsetX+18)+'px';tooltip.style.top=(event.offsetY-6)+'px';tooltip.classList.add('show')};
      path.onmouseleave=()=>document.getElementById('mapTooltip')?.classList.remove('show');
    });
  }catch{if(version===geoRenderVersion)host.innerHTML='<div class="empty-state"><b>Mapa indisponível</b><span>Tente atualizar a página.</span></div>'}
  if(version===geoRenderVersion){renderNationalSummary();updateGeoKpis()}
}
async function renderStateMap(uf){
  if(!brNames[uf])return;const version=++geoRenderVersion;geoLevel=uf;document.getElementById('backToBrazil').hidden=false;
  document.getElementById('mapTitle').textContent=`Cobertura municipal · ${brNames[uf]}`;document.getElementById('mapSubtitle').textContent='Passe o mouse ou clique em um município para consultar os despachos';document.querySelector('.territory-body').classList.add('state-view');
  const host=document.getElementById('brazilMap');host.innerHTML='<div class="empty-state">Carregando limites municipais…</div>';
  if(geoError){geoFailure();return;}showStateSummary(uf);
  try{
    const response=await fetch(`assets/municipal/${uf}.svg`);if(!response.ok)throw new Error('map');const svg=await response.text();if(version!==geoRenderVersion)return;
    host.innerHTML=`<div class="vector-map municipal-vector">${svg}<div class="municipal-source">Malha Municipal IBGE 2024</div><div class="map-tooltip" id="mapTooltip"></div></div>`;
    const paths=[...host.querySelectorAll('[data-city]')],total=Number(host.querySelector('svg').dataset.municipalities)||paths.length,covered=[];
    paths.forEach(path=>{
      const city=path.dataset.city,count=sumEquipment(filteredEquipment(uf).filter(entry=>normalizeCityName(entry.city)===normalizeCityName(city)));
      path.dataset.count=count;path.classList.add(count?'covered':'open-market');if(count)covered.push(path);
      path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-label',`${city}: ${count?count+' equipamentos despachados':'sem equipamentos despachados'}`);
      const showTooltip=event=>{const tooltip=document.getElementById('mapTooltip'),rect=host.getBoundingClientRect(),x=event.clientX?event.clientX-rect.left:rect.width/2,y=event.clientY?event.clientY-rect.top:rect.height/2;tooltip.innerHTML=`<b>${geoEscape(city)}</b><span>${count?count.toLocaleString('pt-BR')+' equipamentos despachados':'Sem equipamentos despachados'}</span>`;tooltip.style.left=Math.min(x+14,rect.width-185)+'px';tooltip.style.top=Math.max(8,y-8)+'px';tooltip.classList.add('show')};
      path.onpointermove=showTooltip;path.onpointerleave=()=>document.getElementById('mapTooltip')?.classList.remove('show');
      path.onclick=()=>{paths.forEach(item=>item.classList.remove('selected-city'));path.classList.add('selected-city');toast(`${city}: ${count.toLocaleString('pt-BR')} equipamentos despachados`)};
      path.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();path.onclick()}};
    });
    const summary=document.querySelector('#stateDetail .geo-summary-head p:last-child');if(summary)summary.textContent=`${covered.length} de ${total} municípios com despacho`;
    host.querySelector('.municipal-source').textContent=`Malha Municipal IBGE 2024 · ${total} municípios`;
  }catch{if(version===geoRenderVersion)host.innerHTML='<div class="empty-state"><b>Mapa municipal indisponível</b><span>Tente atualizar a página.</span></div>'}
}
async function refreshGeo(){
  const version=++geoLoadVersion;
  try{
    const response=await fetch('/api/coverage',{credentials:'same-origin'});if(!response.ok)throw new Error('coverage');const data=await response.json();if(version!==geoLoadVersion)return;
    geoEntries=Array.isArray(data.entries)?data.entries:[];geoLoaded=true;geoError='';
    const brandSelect=document.getElementById('brandFilter'),selected=brandSelect.value;
    brandSelect.innerHTML='<option>Todas</option>'+[...new Set(['Bixolon','Zebra',...geoEntries.map(entry=>entry.brand)])].map(brand=>`<option value="${geoEscape(brand)}">${geoEscape(brand)}</option>`).join('');
    brandSelect.value=selected;
  }catch{if(version!==geoLoadVersion)return;geoError='coverage';geoLoaded=false;}
  return geoLevel==='BR'?renderNational():renderStateMap(geoLevel);
}
function renderMinas(){return renderStateMap('MG')}
window.BorealGeo={refresh:refreshGeo,updateKpis:updateGeoKpis};
document.getElementById('backToBrazil').onclick=renderNational;
document.getElementById('brandFilter').onchange=()=>geoLevel==='BR'?renderNational():renderStateMap(geoLevel);
document.getElementById('equipmentFilter').onchange=()=>geoLevel==='BR'?renderNational():renderStateMap(geoLevel);
document.getElementById('stateFilter').onchange=event=>{renderDashboard();event.target.value==='Todos'?renderNational():renderStateMap(event.target.value)};
document.getElementById('clearFilters').onclick=()=>{for(const id of ['brandFilter','equipmentFilter','stateFilter','segmentFilter'])document.getElementById(id).value=id==='brandFilter'?'Todas':'Todos';document.getElementById('ownerFilter').value='Todos os consultores';document.getElementById('periodFilter').value='Este trimestre';renderDashboard();renderNational()};
document.addEventListener('boreal:view',event=>{if(event.detail==='overview')refreshGeo()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.getElementById('overview').classList.contains('active'))refreshGeo()});
setInterval(()=>{if(document.visibilityState==='visible'&&document.getElementById('overview').classList.contains('active'))refreshGeo()},30000);
refreshGeo();
