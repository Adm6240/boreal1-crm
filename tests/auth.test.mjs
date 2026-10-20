import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';
const initial='Fixture-initial-2026!',personal='Fixture-personal-2026!',reset='Fixture-reset-2026!';
const post=(path,data,cookie)=>new Request('https://boreal.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
const get=(path,cookie)=>new Request('https://boreal.test'+path,{headers:cookie?{cookie}:{}});
const cookie=response=>response.headers.get('set-cookie').split(';')[0];
async function create(env,role='commercial',name='Nicholas'){const seed=env.sqlite.prepare('SELECT count(*) AS n FROM app_users WHERE password_hash != ?').get('fixture-unused-hash').n?initial+name:initial;const response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email:name.replaceAll(' ','').toLowerCase()+'@example.test',role,consultantName:name,password:seed})}),env);assert.equal(response.status,201,await response.clone().text());return {...(await response.json()).user,fixturePassword:seed};}
async function signIn(env,user,password=user.fixturePassword||initial){return worker.fetch(post('/api/auth/login',{email:user.email,password}),env);}
async function activate(env,user){let response=await signIn(env,user);assert.equal(response.status,200);response=await worker.fetch(post('/api/auth/password',{currentPassword:user.fixturePassword||initial,password:personal},cookie(response)),env);assert.equal(response.status,200,await response.clone().text());return cookie(response);}
test('Email login forces initial password change; reset and deactivation invalidate sessions',async()=>{
 const env=environment(),user=await create(env);assert.ok(user.id);assert.equal(user.mustChangePassword,true);assert.equal(user.passwordHash,undefined);assert.equal(env.sqlite.prepare('SELECT password_hash FROM app_users WHERE id=?').get(user.id).password_hash.startsWith('$2b$12$'),true);
 assert.equal((await signIn(env,user,'wrong')).status,401);let response=await signIn(env,user);const temporary=cookie(response);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=None; Partitioned/);
 assert.equal((await worker.fetch(get('/api/orders/workflow',temporary),env)).status,403);
 const session=await activate(env,user);assert.equal((await worker.fetch(get('/api/orders/workflow',session),env)).status,200);assert.equal((await worker.fetch(get('/api/me',temporary),env)).status,401);
 response=await worker.fetch(request('/api/users/'+user.id+'/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:reset})}),env);assert.equal(response.status,200);assert.equal((await worker.fetch(get('/api/me',session),env)).status,401);assert.equal((await signIn(env,user,personal)).status,401);
 response=await signIn(env,user,reset);assert.equal(response.status,200);const resetSession=cookie(response);assert.equal((await response.json()).user.mustChangePassword,true);
 const update=await worker.fetch(request('/api/users/'+user.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...user,active:false})}),env);assert.equal(update.status,200);assert.equal((await worker.fetch(get('/api/me',resetSession),env)).status,401);assert.equal((await signIn(env,user,reset)).status,401);
});
test('Commercial can only read own goal, company aggregates and own orders; cannot mutate operations or users',async()=>{
 const env=environment(),user=await create(env),session=await activate(env,user);
 const config={year:2026,generalTarget:1000000,superPercent:130,generalBonusPercent:100,superBonusPercent:200,annual:{Nicholas:100000,Danielle:900000}};
 await worker.fetch(request('/api/goals/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)}),env);
 let response=await worker.fetch(get('/api/goals/config',session),env),data=await response.json();assert.deepEqual(data.settings.annual,{Nicholas:100000});assert.equal(data.settings.generalTarget,1000000);
 for(const [path,method,body] of [['/api/users','GET'],['/api/users','POST',{name:'Forged'}],['/api/goals/config','PUT',config],['/api/orders/workflow/11111111-1111-4111-8111-111111111111','POST',{module:'stock',action:'stock_intake',revision:1}]]){response=await worker.fetch(new Request('https://boreal.test'+path,{method,headers:{cookie:session,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);assert.equal(response.status,403,path);}
 const makeOrder=consultant=>({id:crypto.randomUUID(),revision:0,snapshot:{project:consultant,consultant,contact:'',email:'',phone:'',value:100000,software:null},movement:'Venda',orderValue:consultant==='Nicholas'?75000:705000,delivery:{recipient:'Cliente',postalCode:'30100000',street:'Rua',number:'1',complement:'',district:'Centro',city:'Belo Horizonte',state:'MG'},items:[{kind:'equipment',brand:'Zebra',description:'TC21',quantity:1}],notes:''});
 for(const name of ['Nicholas','Danielle']){response=await worker.fetch(request('/api/client-orders?client=Cliente&state=MG',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(makeOrder(name))}),env);assert.equal(response.status,201);}
 data=await (await worker.fetch(get('/api/goals/actuals?year=2026',session),env)).json();assert.deepEqual(Object.keys(data.monthly),['Nicholas']);assert.equal(data.monthly.Nicholas.reduce((a,b)=>a+b),75000);assert.equal(data.companyMonthly.reduce((a,b)=>a+b),780000);
 data=await (await worker.fetch(get('/api/orders/workflow',session),env)).json();assert.equal(data.orders.length,1);assert.equal(data.orders[0].snapshot.consultant,'Nicholas');
 data=await (await worker.fetch(get('/api/client-orders?client=Cliente&state=MG',session),env)).json();assert.equal(data.orders.length,1);
});
test('Sector roles are denied other sectors, CRM, goals and user management',async()=>{
 const env=environment();for(const role of ['stock','maintenance','dispatch']){const user=await create(env,role,role),session=await activate(env,user);assert.equal((await worker.fetch(get('/api/orders/workflow',session),env)).status,200);
 for(const path of ['/api/users','/api/clients','/api/goals/config'])assert.equal((await worker.fetch(get(path,session),env)).status,403);
 const wrong=role==='stock'?'maintenance':'stock';assert.equal((await worker.fetch(post('/api/orders/workflow/11111111-1111-4111-8111-111111111111',{module:wrong,action:'stock_intake'},session),env)).status,403);
 const allowed=await worker.fetch(post('/api/orders/workflow/11111111-1111-4111-8111-111111111111',{module:role,action:{stock:'stock_intake',maintenance:'maintenance_start',dispatch:'dispatch_prepare'}[role],revision:1},session),env);assert.equal(allowed.status,404);}
});
test('Only verified site owner can initialize first administrator; header identity cannot bypass a password',async()=>{
 const env=environment({emptyUsers:true});assert.equal((await worker.fetch(get('/api/me'),env)).status,401);
 let response=await worker.fetch(request('/api/me'),env);assert.equal(response.status,200);assert.equal((await response.json()).user.bootstrap,true);assert.equal((await worker.fetch(request('/api/users'),env)).status,403);
 response=await worker.fetch(request('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:personal})}),env);assert.equal(response.status,200);assert.equal((await worker.fetch(request('/api/me'),env)).status,401);assert.equal((await worker.fetch(get('/api/users',cookie(response)),env)).status,200);
});
test('Default initial password is hashed, user IDs unique, and login attempts are limited',async()=>{
 const env=environment();let response=await worker.fetch(request('/api/users/default-password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:initial})}),env);assert.equal(response.status,200);
 const data={name:'Default User',email:'default@example.test',role:'commercial',consultantName:'Default User',userCode:'C004'};
 response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env);assert.equal(response.status,400);response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,password:initial})}),env);assert.equal(response.status,201);assert.equal((await response.json()).user.userCode,'C004');assert.equal((await signIn(env,data)).status,200);
 response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,email:'second@example.test',password:reset})}),env);assert.equal(response.status,409);
 env.sqlite.prepare('INSERT INTO auth_attempts VALUES (?,?,?)').run('email:'+await (await import('../server/email.mjs')).digest(new TextEncoder().encode('default@example.test')),10,Date.now()+60000);assert.equal((await signIn(env,data)).status,429);
 assert.equal((await worker.fetch(new Request('https://boreal.test/api/auth/login',{method:'POST',headers:{origin:'https://attacker.test','Content-Type':'application/json'},body:JSON.stringify({email:data.email,password:initial})}),env)).status,403);
});

test('Hosted default cannot provision users without an individual temporary password',async()=>{
 const env=environment(),password='Example123@!';
 env.BOREAL_INITIAL_PASSWORD_HASH=await (await import('bcryptjs')).default.hash(password,12);
 const data={name:'Default New',email:'new-default@example.test',role:'commercial',consultantName:'Default New'};
 let response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
 assert.equal(response.status,400);response=await worker.fetch(request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,password})}),env);assert.equal(response.status,201);
 const user=(await response.json()).user;response=await signIn(env,user,password);assert.equal(response.status,200);assert.equal((await response.json()).user.mustChangePassword,true);
 response=await worker.fetch(post('/api/auth/password',{currentPassword:password,password:personal},cookie(response)),env);assert.equal(response.status,200);
 response=await worker.fetch(request('/api/users/default-password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:reset})}),env);assert.equal(response.status,200);
 await worker.fetch(request('/api/users'),env);
 assert.equal(await (await import('bcryptjs')).default.compare(reset,env.sqlite.prepare('SELECT default_hash FROM auth_settings WHERE id=1').get().default_hash),true);
});

 test('First access requires a different personal password and logout revokes the session',async()=>{
 const env=environment(),user=await create(env);let response=await signIn(env,user);const first=cookie(response);
 response=await worker.fetch(post('/api/auth/password',{currentPassword:'wrong',keepCurrent:true},first),env);assert.equal(response.status,403);
 response=await worker.fetch(post('/api/auth/password',{currentPassword:initial,keepCurrent:true},first),env);assert.equal(response.status,400);response=await worker.fetch(post('/api/auth/password',{currentPassword:initial,password:personal},first),env);assert.equal(response.status,200,await response.clone().text());const session=cookie(response);assert.equal((await response.json()).user.mustChangePassword,false);
 assert.equal((await worker.fetch(get('/api/orders/workflow',session),env)).status,200);
 assert.equal((await worker.fetch(get('/api/me',first),env)).status,401);
 response=await worker.fetch(post('/api/auth/logout',{},session),env);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Partitioned; Max-Age=0/);
 assert.equal((await worker.fetch(get('/api/me',session),env)).status,401);
 assert.equal((await signIn(env,user,personal)).status,200);
 });

test('Requested owner recovery is identity-bound, grants admin login once and preserves subsequent passwords',async()=>{
 const env=environment({emptyUsers:true});await worker.fetch(request('/api/me'),env);
 env.BOREAL_OWNER_RECOVERY_HASH=await (await import('bcryptjs')).default.hash(initial,12);
 const loginRequest=()=>request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.invalid',password:initial})});
 assert.equal((await worker.fetch(post('/api/auth/login',{email:'admin@example.invalid',password:initial}),env)).status,401);
 let response=await worker.fetch(loginRequest(),env);assert.equal(response.status,200,await response.clone().text());const session=cookie(response);const user=(await response.json()).user;assert.equal(user.role,'admin');assert.equal(user.mustChangePassword,false);
 assert.equal((await worker.fetch(get('/api/users',session),env)).status,200);
 response=await worker.fetch(post('/api/auth/password',{currentPassword:user.fixturePassword||initial,password:personal},session),env);assert.equal(response.status,200);
 assert.equal((await worker.fetch(loginRequest(),env)).status,401);
 });

test('Sector migration creates ID logins with configured password and restricts APIs',async()=>{
 const env=environment();
 await worker.fetch(request('/api/users/default-password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:initial})}),env);
 env.sqlite.prepare('INSERT INTO goal_settings VALUES (?,?,?,?)').run(2026,JSON.stringify({annual:{'Consultor Exemplo':2160000},generalTarget:4500000}),'fixture','2026-09-29');
 const migration=(await import('node:fs')).readFileSync('drizzle/0006_sector_access.sql','utf8');env.sqlite.exec(migration);env.sqlite.exec(migration);
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM app_users').get().n,4);
 const config=JSON.parse(env.sqlite.prepare('SELECT payload FROM goal_settings').get().payload);assert.deepEqual(config.annual,{'CONSULTOR DESATIVADO':2160000});assert.equal(config.generalTarget,4500000);
 for(const [id,role] of [['Estoque','stock'],['Manutencao','maintenance'],['Expedição','dispatch']]){
  assert.equal((await worker.fetch(post('/api/auth/login',{email:id,password:initial}),env)).status,401);
  const row=env.sqlite.prepare('SELECT id FROM app_users WHERE role=?').get(role),temporary=initial+role;
  let response=await worker.fetch(request('/api/users/'+row.id+'/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:temporary})}),env);assert.equal(response.status,200);
  response=await worker.fetch(post('/api/auth/login',{email:id,password:temporary}),env);assert.equal(response.status,200);const data=await response.clone().json();assert.equal(data.user.role,role);assert.equal(data.user.mustChangePassword,true);
  response=await worker.fetch(post('/api/auth/password',{currentPassword:temporary,password:personal+role},cookie(response)),env);assert.equal(response.status,200);const session=cookie(response);
  assert.equal((await worker.fetch(get('/api/orders/workflow',session),env)).status,200);
  for(const path of ['/api/users','/api/clients','/api/coverage','/api/goals/config','/api/client-history?client=X&state=MG'])assert.equal((await worker.fetch(get(path,session),env)).status,403,path);
  const other=role==='stock'?'dispatch':'stock';assert.equal((await worker.fetch(post('/api/orders/workflow/11111111-1111-4111-8111-111111111111',{module:other},session),env)).status,403);
  assert.equal((await worker.fetch(post('/api/auth/logout',{},session),env)).status,200);assert.equal((await worker.fetch(get('/api/me',session),env)).status,401);
 }
});
