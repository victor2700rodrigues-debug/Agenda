import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signInWithRedirect,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,sendPasswordResetEmail,signOut,reload,updateProfile} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,doc,setDoc,deleteDoc,collection,onSnapshot,getDocs} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";

const fapp=initializeApp(firebaseConfig);
const auth=getAuth(fapp);auth.languageCode="pt-BR";
const fdb=initializeFirestore(fapp,{ignoreUndefinedProperties:true,localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});

const TIPOS=["Instalação","Limpeza / higienização","Manutenção preventiva","Reparo","Recarga de gás","Visita técnica"];
const S={clientes:new Map(),servicos:new Map(),materiais:new Map(),orcamentos:new Map(),config:new Map()};
const COLS=["clientes","servicos","materiais","orcamentos","config"];
const TABS=["agenda","lembretes","orcamentos","clientes","estoque"];
const BELL='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3L2 11.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5zM6.2 13a1.9 1.9 0 0 0 3.6 0z" fill="currentColor"/></svg>';
let tab="agenda";

/* ---------- datas ---------- */
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
function addMonths(s,n){const d=parse(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d)}
const diffDays=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const WD=["dom","seg","ter","qua","qui","sex","sáb"],MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const short=s=>{const d=parse(s);return pad(d.getDate())+" "+MES[d.getMonth()]};
function dayTitle(s){const t=today(),n=diffDays(t,s),d=parse(s);
  if(n===0)return"Hoje";if(n===1)return"Amanhã";if(n===-1)return"Ontem";
  return WD[d.getDay()]+", "+d.getDate()+" de "+MES[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?" de "+d.getFullYear():"")}
const money=v=>v?Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}):"";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

/* ---------- armazenamento ---------- */
let uidAtual=null;
const refDoc=(col,id)=>doc(fdb,"users",uidAtual,col,id);
async function save(col,id,data){
  S[col].set(id,data);render();
  try{await setDoc(refDoc(col,id),data)}catch(e){console.error(e);toast("Não foi possível salvar. Verifique sua conexão.")}
}
async function remove(col,id){S[col].delete(id);render();try{await deleteDoc(refDoc(col,id))}catch(e){console.error(e);toast("Não foi possível excluir.")}}

/* ---------- consultas ---------- */
const svcs=()=>[...S.servicos.entries()].map(([id,v])=>({id,...v}));
const cli=id=>S.clientes.get(id)||{nome:"Cliente removido"};
const byDate=(a,b)=>(a.data+(a.hora||"99")).localeCompare(b.data+(b.hora||"99"));
const isEx=o=>o&&o.exemplo;
const num=v=>{v=String(v||"").trim();if(v.includes(","))v=v.replace(/\./g,"").replace(",",".");return parseFloat(v)||0};
const qfmt=n=>Number(n||0).toLocaleString("pt-BR",{maximumFractionDigits:2});
const matTxt=s=>(s.materiais||[]).map(m=>qfmt(m.qtd)+" "+(m.unidade||"")+" "+m.nome).join(", ");
const docLabel=c=>c.pessoa==="PJ"?"CNPJ":"CPF";
/* ---------- render ---------- */
const WDF=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"],MESF=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
let diaSel=null,filtro="todos",lembSeg=null,nomeUser="";
const primeiro=n=>String(n||"").trim().split(/\s+/)[0]||"";
const moneyShort=v=>v>=1000?"R$ "+(v/1000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mil":(money(v)||"R$ 0");
const isPJ=c=>c.pessoa==="PJ";
const assinatura=()=>{const e=empresa().nome;return nomeUser?`Aqui é o ${primeiro(nomeUser)}${e?", da "+e:""}.`:e?`Aqui é da ${e}.`:""};
function waHref(c,msg){const dig=String(c.telefone||"").replace(/\D/g,"");if(dig.length<10)return"";
  return"https://wa.me/"+(dig.length<=11?"55"+dig:dig)+"?text="+encodeURIComponent(msg)}
const mapsHref=c=>c.endereco?"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(c.endereco):"";
function msgLembrete(s){const c=cli(s.clienteId),o=s.origemId&&S.servicos.get(s.origemId);
  return`Olá, ${primeiro(c.nome)}! ${assinatura()} ${s.intervalo?`Já faz ${s.intervalo} meses da última ${(o?o.tipo:"manutenção").toLowerCase()} do seu ar condicionado.`:"Já está chegando a hora da manutenção preventiva do seu ar condicionado."} Posso agendar a próxima visita para esta semana?`.replace(/\s+/g," ")}
function msgVisita(s,late){const c=cli(s.clienteId);
  return(late?`Olá, ${primeiro(c.nome)}! ${assinatura()} Tive um imprevisto com a visita do seu ar condicionado. Podemos remarcar?`
    :`Olá, ${primeiro(c.nome)}! ${assinatura()} Confirmando a visita de ${s.tipo.toLowerCase()} ${dayTitle(s.data).toLowerCase()}${s.hora?" às "+s.hora:""}. Tudo certo?`).replace(/\s+/g," ")}

function svcCard(s,t,{withDay=false}={}){
  const c=cli(s.clienteId),late=s.status==="agendado"&&s.data<t,ok=s.status==="concluido";
  const cls=late?"late":ok?"ok":isPJ(c)?"pj":"";
  const when=(withDay?(s.data===t?"hoje":dayTitle(s.data).toLowerCase())+(s.hora?" · ":""):"")+(s.hora||"");
  const chips=[];
  if(isPJ(c))chips.push(`<span class="chip bell" title="Cliente CNPJ">${BELL}CNPJ</span>`);
  chips.push(late?'<span class="chip late">atrasado</span>':ok?'<span class="chip ok">✓ concluído</span>':isPJ(c)?"":'<span class="chip">agendado</span>');
  if(isEx(s)||isEx(c))chips.push('<span class="chip ex">exemplo</span>');
  const meta=[esc(s.tipo)+(s.valor?" · "+money(s.valor):"")];
  if(c.endereco)meta.push(esc(c.endereco));if(c.equipamentos)meta.push("Equipamento: "+esc(c.equipamentos));
  if(matTxt(s))meta.push("Materiais: "+esc(matTxt(s)));if(s.obs)meta.push(esc(s.obs));
  let acts="";
  if(s.status==="agendado"){const wa=waHref(c,msgVisita(s,late)),mp=mapsHref(c);
    acts=`<div class="btns">${wa?`<a class="wa" href="${wa}" target="_blank" rel="noopener">${late?"Avisar atraso":"WhatsApp"}</a>`:""}${mp?`<a href="${mp}" target="_blank" rel="noopener">Rota</a>`:""}<button class="p" data-act="concluir" data-id="${s.id}">Concluir</button></div>
     <div class="links"><button data-act="editar" data-id="${s.id}">${late?"Remarcar":"Editar"}</button><button data-act="cancelar" data-id="${s.id}">Cancelar</button></div>`}
  return`<div class="card ${cls}"><div class="top-row"><span class="hr">${when||"sem hora"}</span><span>${chips.join(" ")}</span></div>
   <p class="nm">${esc(c.nome)}</p><p class="meta" style="margin:0">${meta.join("<br>")}</p>${acts}</div>`}

function render(){
  const t=today(),all=svcs();
  const agendados=all.filter(s=>s.status==="agendado").sort(byDate);
  const previstos=all.filter(s=>s.status==="previsto").sort(byDate);
  const lembAtivos=previstos.filter(s=>diffDays(t,s.data)<=30);
  const b=document.getElementById("b-lemb");b.hidden=!lembAtivos.length;b.textContent=lembAtivos.length;
  renderAgenda(all,agendados,lembAtivos,t);renderLembretes(previstos,lembAtivos,t);renderClientes();renderEstoque();renderOrcamentos();
  const baixo=[...S.materiais.values()].filter(m=>m.minimo&&(+m.quantidade||0)<=+m.minimo).length;
  const be=document.getElementById("b-est");be.hidden=!baixo;be.textContent=baixo;
  salvarContagem();
}
function renderAgenda(all,agendados,lembAtivos,t){
  const el=document.getElementById("p-agenda"),h=new Date().getHours(),d=parse(t);
  const hoje=agendados.filter(s=>s.data===t).length;
  const mes=t.slice(0,7),fat=all.filter(s=>s.status==="concluido"&&String(s.data).startsWith(mes)).reduce((a,s)=>a+(+s.valor||0),0);
  let html=`<div><h2 class="hello">${h<12?"Bom dia":h<18?"Boa tarde":"Boa noite"}${nomeUser?", "+esc(primeiro(nomeUser)):""}</h2>
   <p class="meta">${WDF[d.getDay()]}, ${d.getDate()} de ${MESF[d.getMonth()]} · ${hoje?hoje+(hoje>1?" serviços hoje":" serviço hoje"):"nenhum serviço hoje"}</p></div>
   <div class="summary">
    <button class="stat" data-act="dia" data-dia="${t}"><i style="background:var(--accent-soft)">🗓️</i><b>${hoje}</b><span>Hoje</span></button>
    <button class="stat" data-act="filtro" data-f="concluidos"><i style="background:var(--ok-soft)">💰</i><b class="money">${moneyShort(fat)}</b><span>No mês</span></button>
    <button class="stat alert" data-go="lembretes"><i style="background:var(--warn-soft)">🔔</i><b>${lembAtivos.length}</b><span>Para oferecer</span></button>
   </div>`;
  const prox=agendados.find(s=>s.data>=t);
  if(prox)html+=`<div class="group"><div class="sec"><h2>Próximo serviço</h2></div>${svcCard(prox,t,{withDay:true})}</div>`;
  const low=[...S.materiais.entries()].map(([id,m])=>({id,...m})).filter(m=>m.minimo&&(+m.quantidade||0)<=+m.minimo).slice(0,4);
  if(low.length)html+=`<div class="group"><div class="sec"><h2>Estoque baixo</h2><button data-go="estoque">Ver estoque</button></div><div class="card" style="padding-left:12px">${low.map(m=>{const q=+m.quantidade||0,pct=Math.max(4,Math.min(100,q/(2*m.minimo)*100));
    return`<div class="low"><div class="top-row"><span>${esc(m.nome)}</span><span class="chip ${q<=0?"late":"warn"}">${qfmt(q)} ${esc(m.unidade||"un")}</span></div><div class="lowbar"><i class="${q<=0?"zero":""}" style="width:${q<=0?100:pct}%"></i></div></div>`}).join("")}</div></div>`;
  const atras=agendados.filter(s=>s.data<t);
  if(atras.length)html+=`<div class="group"><div class="sec"><h2 style="color:var(--late)">Atrasados (${atras.length})</h2></div>${atras.map(s=>svcCard(s,t,{withDay:true})).join("")}</div>`;
  // faixa de dias
  const dias=[];for(let i=-1;i<14;i++)dias.push(addDays(t,i));
  const porDia=new Map();for(const s of agendados){if(!porDia.has(s.data))porDia.set(s.data,[]);porDia.get(s.data).push(s)}
  html+=`<div class="group"><div class="sec"><h2>${diaSel?dayTitle(diaSel):"Agenda"}</h2>${diaSel?'<button data-act="dia" data-dia="">Ver todos os próximos</button>':""}</div>
   <div class="days">${dias.map(x=>{const ss=porDia.get(x)||[],dd=parse(x),pj=ss.some(s=>isPJ(cli(s.clienteId)));
     return`<button class="day${x===t?" hoje":""}" data-act="dia" data-dia="${x}" aria-pressed="${x===diaSel}">${WD[dd.getDay()]}<b>${dd.getDate()}</b><i class="${ss.length?(pj?"pj":"s"):""}"></i></button>`}).join("")}</div>
   <div class="filters">${[["todos","Todos"],["cnpj","🔔 CNPJ"],["pendentes","Pendentes"],["concluidos","Concluídos"]].map(([k,l])=>`<button data-act="filtro" data-f="${k}" aria-pressed="${filtro===k}">${l}</button>`).join("")}</div>`;
  let lista;
  if(diaSel)lista=all.filter(s=>s.data===diaSel&&(s.status==="agendado"||s.status==="concluido"));
  else if(filtro==="concluidos"){const ini=addDays(t,-30);lista=all.filter(s=>s.status==="concluido"&&s.data>=ini).sort(byDate).reverse()}
  else lista=agendados.filter(s=>s.data>=t);
  if(filtro==="cnpj")lista=lista.filter(s=>isPJ(cli(s.clienteId)));
  if(filtro==="pendentes")lista=lista.filter(s=>s.status==="agendado");
  if(filtro==="concluidos")lista=lista.filter(s=>s.status==="concluido");
  if(diaSel)lista.sort(byDate);
  if(!lista.length){
    const vazio=!all.some(s=>s.status==="agendado"||s.status==="concluido");
    html+=vazio?`<div class="empty"><strong>Nenhum serviço agendado</strong>Toque no + para marcar uma visita. Quando concluir um serviço, a próxima manutenção já fica pré-agendada nos lembretes.</div>`
      :`<div class="empty">Nada ${filtro==="concluidos"?"concluído":"agendado"}${filtro==="cnpj"?" de CNPJ":""} ${diaSel?"neste dia":filtro==="concluidos"?"nos últimos 30 dias":"daqui para frente"}.</div>`}
  else if(diaSel)html+=lista.map(s=>svcCard(s,t)).join("");
  else{let last="";for(const s of lista){if(s.data!==last){last=s.data;html+=`<h3 class="meta" style="margin:6px 0 0;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:12px">${dayTitle(s.data)}</h3>`}html+=svcCard(s,t)}}
  html+="</div>";
  el.innerHTML=html}
function renderLembretes(list,ativos,t){
  const el=document.getElementById("p-lembretes");
  if(!list.length){el.innerHTML=`<div class="empty"><strong>Nenhuma manutenção pré-agendada</strong>Ao concluir um serviço na Agenda, escolha 3 ou 6 meses e o cliente aparece aqui na hora certa de oferecer a manutenção de novo.</div>`;return}
  const g={late:[],semana:[],prox:[]};
  for(const s of list){const n=diffDays(t,s.data);(n<0?g.late:n<=7?g.semana:g.prox).push(s)}
  if(!lembSeg||!g[lembSeg].length)lembSeg=["late","semana","prox"].find(k=>g[k].length);
  const pot=ativos.reduce((a,s)=>{const o=s.origemId&&S.servicos.get(s.origemId);return a+(o&&+o.valor||0)},0);
  const n=ativos.length;
  let html=n?`<div class="banner"><div><strong>${n} ${n>1?"clientes":"cliente"} para oferecer</strong><span class="meta">${pot?"Potencial de "+money(pot)+" em manutenções":"Mande uma mensagem e agende a próxima visita"}</span></div><span class="ic" aria-hidden="true">🔔</span></div>`:"";
  html+=`<div class="filters">${[["late","Vencidos"],["semana","Esta semana"],["prox","Próximos"]].map(([k,l])=>`<button data-act="lseg" data-f="${k}" aria-pressed="${lembSeg===k}">${l} (${g[k].length})</button>`).join("")}</div>`;
  html+=g[lembSeg].map(s=>{const c=cli(s.clienteId),d=diffDays(t,s.data),o=s.origemId&&S.servicos.get(s.origemId);
    const chip=d<0?`<span class="chip late">venceu há ${-d} ${d===-1?"dia":"dias"}</span>`:d===0?'<span class="chip warn">vence hoje</span>':d===1?'<span class="chip warn">vence amanhã</span>':`<span class="chip ${d<=7?"warn":"mute"}">vence em ${d} dias</span>`;
    return`<div class="card ${d<0?"late":isPJ(c)?"pj":d>30?"mute":""}"><div class="top-row"><p class="nm">${esc(c.nome)}</p><span>${isPJ(c)?`<span class="chip bell">${BELL}CNPJ</span> `:""}${chip}</span></div>
     <p class="meta" style="margin:0">${o?`Última ${esc(o.tipo.toLowerCase())}: ${short(o.data)}`:`Previsto para ${short(s.data)}`}${s.intervalo?` · plano de ${s.intervalo} meses`:""}${isEx(s)||isEx(c)?' · <span class="chip ex">exemplo</span>':""}</p>
     <div class="btns"><button class="wa" data-act="msg" data-id="${s.id}">💬 Mandar mensagem</button><button data-act="agendar" data-id="${s.id}">Agendar</button></div>
     <div class="links"><button data-act="dispensar" data-id="${s.id}">Cliente não quis</button></div></div>`}).join("");
  el.innerHTML=html}
function sheetMsg(id){const s=S.servicos.get(id),c=cli(s.clienteId),tem=waHref(c,"x");
  openSheet(`<h3>Mensagem para ${esc(primeiro(c.nome))}</h3><p class="meta">Confira o texto. Você pode mudar o que quiser antes de enviar.</p>
   <textarea class="msg" id="m-txt">${esc(msgLembrete(s))}</textarea>${tem?"":'<p class="meta">Este cliente está sem telefone com DDD. Copie o texto ou cadastre o número na ficha dele.</p>'}
   <div class="sheet-actions"><button id="cp">Copiar texto</button>${tem?'<button class="primary" id="wa">Enviar no WhatsApp</button>':""}</div>`,bg=>{
    const tx=()=>bg.querySelector("#m-txt").value.trim();
    bg.querySelector("#cp").onclick=()=>navigator.clipboard?.writeText(tx()).then(()=>toast("Mensagem copiada"),()=>toast(tx()));
    const w=bg.querySelector("#wa");if(w)w.onclick=()=>{window.open(waHref(c,tx()),"_blank","noopener");close()}})}
/* ---------- administrador ---------- */
const ADMIN_EMAIL="victor2700rodrigues@gmail.com";
const ehAdmin=()=>(auth.currentUser?.email||"").toLowerCase()===ADMIN_EMAIL;
let carregadas=new Set(),ultContagem="",timerContagem=null;
function salvarPerfil(u){
  const prov=u.providerData.some(p=>p.providerId==="google.com")?"Google":"E-mail";
  const criado=u.metadata?.creationTime?new Date(u.metadata.creationTime).toISOString():null;
  setDoc(doc(fdb,"perfis",u.uid),{email:u.email||"",nome:u.displayName||"",provedor:prov,criadoEm:criado,ultimoAcesso:new Date().toISOString()},{merge:true}).catch(e=>console.error(e))}
function salvarContagem(){
  if(!uidAtual||carregadas.size<COLS.length)return;
  const c={clientes:S.clientes.size,servicos:[...S.servicos.values()].filter(s=>s.status==="agendado"||s.status==="concluido").length,orcamentos:S.orcamentos.size};
  const k=JSON.stringify(c);if(k===ultContagem)return;ultContagem=k;
  clearTimeout(timerContagem);const uid0=uidAtual;
  timerContagem=setTimeout(()=>setDoc(doc(fdb,"perfis",uid0),{contagem:c},{merge:true}).catch(e=>console.error(e)),2000)}
const dataHora=s=>{if(!s)return"—";const d=new Date(s);return pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear()+" "+pad(d.getHours())+":"+pad(d.getMinutes())};
async function sheetAdmin(){
  openSheet(`<h3>Painel do administrador</h3><p class="meta">Carregando contas…</p>`);
  let perfis;
  try{perfis=(await getDocs(collection(fdb,"perfis"))).docs.map(d=>({uid:d.id,...d.data()}))}
  catch(e){console.error(e);openSheet(`<h3>Painel do administrador</h3><p class="err">Sem permissão para ver as contas. Confira se as regras novas foram publicadas no Firebase.</p><div class="sheet-actions"><button data-close>Fechar</button></div>`);return}
  perfis.sort((a,b)=>String(b.ultimoAcesso||"").localeCompare(String(a.ultimoAcesso||"")));
  const agora=Date.now(),dia=864e5;
  const ativos7=perfis.filter(p=>p.ultimoAcesso&&agora-new Date(p.ultimoAcesso)<=7*dia).length;
  const novos30=perfis.filter(p=>p.criadoEm&&agora-new Date(p.criadoEm)<=30*dia).length;
  const lista=q=>perfis.filter(p=>!q||(p.email+" "+p.nome).toLowerCase().includes(q)).map(p=>{const c=p.contagem||{};
    return`<div class="card" style="padding-left:12px"><div class="top-row"><p class="nm">${esc(p.nome||p.email)}</p><span class="chip ${p.provedor==="Google"?"":"mute"}">${esc(p.provedor||"")}</span></div>
     <p class="meta" style="margin:0">${esc(p.email)}<br>Conta criada: ${dataHora(p.criadoEm)} · Último acesso: ${dataHora(p.ultimoAcesso)}<br><b>${c.clientes??"—"}</b> clientes · <b>${c.servicos??"—"}</b> serviços · <b>${c.orcamentos??"—"}</b> orçamentos</p></div>`}).join("")||'<p class="meta">Nenhuma conta encontrada.</p>';
  openSheet(`<h3>Painel do administrador</h3>
   <div class="summary"><div class="stat"><b>${perfis.length}</b><span>Contas</span></div><div class="stat"><b>${ativos7}</b><span>Ativas em 7 dias</span></div><div class="stat"><b>${novos30}</b><span>Novas em 30 dias</span></div></div>
   <input id="adm-busca" type="search" placeholder="Buscar por nome ou e-mail"><div class="group" id="adm-lista">${lista("")}</div>
   <p class="meta">Contas aparecem aqui a partir do primeiro acesso depois desta atualização.</p>
   <div class="sheet-actions"><button data-close>Fechar</button></div>`,bg=>{bg.querySelector("#adm-busca").oninput=e=>bg.querySelector("#adm-lista").innerHTML=lista(e.target.value.toLowerCase().trim())})}
function sheetConta(){const u=auth.currentUser||{};
  openSheet(`<h3>${esc(u.displayName||"Sua conta")}</h3><p class="meta">${esc(u.email||"")}</p><div class="conta">
   ${ehAdmin()?'<button data-act="admin">Painel do administrador</button>':""}<button data-act="empresa-dados">Seus dados no PDF do orçamento</button>${!instalarBtn.hidden?'<button data-act="instalar">Instalar app no celular</button>':""}<button id="sair">Sair da conta</button></div>
   <div class="sheet-actions"><button data-close>Fechar</button></div>`,bg=>{bg.querySelector("#sair").onclick=()=>{close();signOut(auth)}})}
function renderClientes(){
  const q=(document.getElementById("busca").value||"").toLowerCase().trim(),t=today(),all=svcs();
  const rows=[...S.clientes.entries()].map(([id,c])=>({id,...c})).filter(c=>!q||[c.nome,c.telefone,c.endereco,c.equipamentos,c.documento].join(" ").toLowerCase().includes(q)).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
  const el=document.getElementById("lista-clientes");
  if(!S.clientes.size){el.innerHTML=`<div class="empty"><strong>Nenhum cliente cadastrado</strong>Cadastre o primeiro em “Novo cliente” ou direto ao marcar um serviço.</div>`;return}
  if(!rows.length){el.innerHTML=`<div class="empty">Nenhum cliente encontrado para “${esc(q)}”.</div>`;return}
  el.innerHTML=rows.map(c=>{
    const mine=all.filter(s=>s.clienteId===c.id);
    const prox=mine.filter(s=>s.status==="agendado"||s.status==="previsto").sort(byDate)[0];
    const ult=mine.filter(s=>s.status==="concluido").sort(byDate).pop();
    return`<button class="client" data-act="cliente" data-id="${c.id}"><div class="body"><div class="line1"><strong>${esc(c.nome)}</strong><span class="chip ${c.pessoa==="PJ"?"":"mute"}">${c.pessoa==="PJ"?"CNPJ":"Pessoa física"}</span>${isEx(c)?'<span class="chip ex">exemplo</span>':""}</div>
     <div class="meta">${esc(c.telefone||"sem telefone")}${c.documento?" · "+docLabel(c)+" "+esc(c.documento):""}${c.endereco?" · "+esc(c.endereco):""}</div>
     <div class="meta">${ult?"Último: "+short(ult.data)+" "+esc(ult.tipo):"Sem serviço concluído"}${prox?" · Próximo: "+short(prox.data)+(prox.status==="previsto"?" (pré-agendado)":""):""}</div></div>
     ${prox&&prox.status==="previsto"&&diffDays(t,prox.data)<=30?'<span class="chip warn">oferecer</span>':""}</button>`}).join("")}

function syncStock(oldM,newM){
  const d={};for(const u of oldM||[])d[u.materialId]=(d[u.materialId]||0)-u.qtd;for(const u of newM||[])d[u.materialId]=(d[u.materialId]||0)+u.qtd;
  for(const [mid,q] of Object.entries(d)){const m=S.materiais.get(mid);if(m&&Math.abs(q)>1e-9)save("materiais",mid,{...m,quantidade:Math.round(((+m.quantidade||0)-q)*100)/100})}}
function matEditor(bg,itens,{preco=false,onChange=()=>{}}={}){
  const box=bg.querySelector("#mats"),ab=bg.querySelector("#add-mat");
  const opts=sel=>[...S.materiais.entries()].sort((a,b)=>a[1].nome.localeCompare(b[1].nome,"pt-BR")).map(([mid,m])=>`<option value="${mid}" ${mid===sel?"selected":""}>${esc(m.nome)} (${qfmt(m.quantidade)} ${esc(m.unidade||"")})</option>`).join("");
  if(!S.materiais.size){ab.hidden=true;box.innerHTML='<p class="meta">Cadastre seus materiais na aba Estoque para escolher aqui.</p>';return{read:()=>[]}}
  if(preco)box.insertAdjacentHTML("beforeend",'<div class="mat-head"><span>Material</span><span>Qtd</span><span>R$ unit.</span><span></span></div>');
  const add=(it={})=>{const r=document.createElement("div");r.className="mat-row"+(preco?" p":"");
    r.innerHTML=`<select aria-label="Material">${opts(it.materialId)}</select><input aria-label="Quantidade" inputmode="decimal" placeholder="Qtd" value="${it.qtd?qfmt(it.qtd):""}">${preco?`<input aria-label="Preço unitário" inputmode="decimal" placeholder="0,00" value="${it.preco!=null?String(it.preco).replace(".",","):""}">`:""}<button type="button" class="ghost" aria-label="Remover">✕</button>`;
    const sel=r.querySelector("select"),pr=preco?r.querySelectorAll("input")[1]:null;
    const setP=()=>{if(pr){const m=S.materiais.get(sel.value);pr.value=m&&(m.preco||m.custo)?String(m.preco||m.custo).replace(".",","):""}};
    if(pr&&it.preco==null)setP();
    sel.onchange=()=>{setP();onChange()};r.querySelectorAll("input").forEach(i=>i.oninput=onChange);
    r.querySelector("button").onclick=()=>{r.remove();onChange()};box.appendChild(r)};
  (itens||[]).forEach(add);ab.onclick=()=>{add();box.lastChild.querySelector("input").focus();onChange()};
  return{read(){const out=[];box.querySelectorAll(".mat-row").forEach(r=>{const mid=r.querySelector("select").value,ins=r.querySelectorAll("input"),q=num(ins[0].value),m=S.materiais.get(mid);
    if(m&&q>0){const o={materialId:mid,nome:m.nome,unidade:m.unidade||"",qtd:q};if(preco)o.preco=num(ins[1].value);out.push(o)}});return out}}}
const MATS_FIELD=(label,help)=>`<div class="field"><label>${label}</label><div class="group" id="mats"></div>
     <button type="button" class="small" id="add-mat" style="align-self:flex-start">+ Adicionar material</button>${help?`<p class="meta">${help}</p>`:""}</div>`;

function renderEstoque(){
  const el=document.getElementById("lista-mat"),q=(document.getElementById("busca-mat").value||"").toLowerCase().trim();
  if(!S.materiais.size){el.innerHTML=`<div class="empty"><strong>Nenhum material cadastrado</strong>Cadastre o que você tem em “+ Cadastrar material” (gás, tubo de cobre, cabo PP, suporte, fita...). Ao concluir um serviço, o que foi usado sai do estoque.</div>`;return}
  const usoMes={},ini=addDays(today(),-30);
  for(const s of svcs())if(s.status==="concluido"&&s.data>=ini)for(const u of s.materiais||[])usoMes[u.materialId]=(usoMes[u.materialId]||0)+u.qtd;
  const rows=[...S.materiais.entries()].map(([id,m])=>({id,...m})).filter(m=>!q||m.nome.toLowerCase().includes(q)).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
  if(!rows.length){el.innerHTML=`<div class="empty">Nenhum material encontrado para “${esc(q)}”.</div>`;return}
  el.innerHTML=rows.map(m=>{const qt=+m.quantidade||0,low=m.minimo&&qt<=+m.minimo;
    return`<div class="item" style="grid-template-columns:minmax(0,1fr) auto"><div class="body"><div class="line1"><strong>${esc(m.nome)}</strong>${qt<=0?'<span class="chip late">sem estoque</span>':low?'<span class="chip warn">estoque baixo</span>':""}${isEx(m)?'<span class="chip ex">exemplo</span>':""}</div>
     <div class="meta">${m.minimo?"Mínimo "+qfmt(m.minimo)+" "+esc(m.unidade||""):"Sem mínimo definido"}${m.custo?" · custo "+money(m.custo):""}${m.preco?" · cobra "+money(m.preco):""}${usoMes[m.id]?" · usado nos últimos 30 dias: "+qfmt(usoMes[m.id]):""}</div>
     <div class="actions"><button class="small primary" data-act="entrada" data-id="${m.id}">Entrada / compra</button><button class="small" data-act="editmat" data-id="${m.id}">Editar</button></div></div>
     <div class="stock">${qfmt(qt)}<small>${esc(m.unidade||"un")}</small></div></div>`}).join("")}
function sheetMaterial(id){
  const m=id?S.materiais.get(id):{unidade:"un"};
  openSheet(`<h3>${id?"Editar material":"Novo material"}</h3>
   <div class="field"><label for="m-nome">Material</label><input id="m-nome" value="${esc(m.nome)}" placeholder="Ex.: Gás R-410A, Tubo de cobre 1/4"></div>
   <div class="row"><div class="field"><label for="m-qtd">Quantidade em estoque</label><input id="m-qtd" inputmode="decimal" value="${m.quantidade??""}"></div>
   <div class="field"><label for="m-un">Unidade</label><select id="m-un">${["un","m","kg","g","rolo","caixa","litro","par"].map(u=>`<option ${u===m.unidade?"selected":""}>${u}</option>`).join("")}</select></div></div>
   <div class="row"><div class="field"><label for="m-min">Avisar quando chegar a</label><input id="m-min" inputmode="decimal" value="${m.minimo||""}" placeholder="Opcional"></div>
   <div class="field"><label for="m-custo">Custo por unidade (R$)</label><input id="m-custo" inputmode="decimal" value="${m.custo||""}" placeholder="Opcional"></div></div>
   <div class="row"><div class="field"><label for="m-preco">Preço para o cliente (R$)</label><input id="m-preco" inputmode="decimal" value="${m.preco||""}" placeholder="Usado no orçamento"></div><div></div></div>
   <p class="err" id="err" hidden></p>
   <div class="sheet-actions">${id?'<button class="ghost" id="del">Excluir</button>':""}<button data-close>Fechar</button><button class="primary" id="ok">Salvar material</button></div>`,bg=>{
    bg.querySelector("#ok").onclick=()=>{const nome=bg.querySelector("#m-nome").value.trim();if(!nome){const e=bg.querySelector("#err");e.hidden=false;e.textContent="Informe o nome do material.";return}
      save("materiais",id||uid(),{...m,nome,quantidade:num(bg.querySelector("#m-qtd").value),unidade:bg.querySelector("#m-un").value,minimo:num(bg.querySelector("#m-min").value),custo:num(bg.querySelector("#m-custo").value),preco:num(bg.querySelector("#m-preco").value)});close();toast("Material salvo")};
    const d=bg.querySelector("#del");if(d)d.onclick=()=>sheetConfirm("Excluir material?",`${esc(m.nome)} sai do estoque. Os serviços que já usaram continuam com o registro.`,"Excluir",()=>{remove("materiais",id);toast("Material excluído")})})}
function sheetEntrada(id){
  const m=S.materiais.get(id);
  openSheet(`<h3>Entrada de material</h3><p class="meta">${esc(m.nome)} · hoje: ${qfmt(m.quantidade)} ${esc(m.unidade||"")}</p>
   <div class="field"><label for="e-qtd">Quantidade que chegou (${esc(m.unidade||"un")})</label><input id="e-qtd" inputmode="decimal"></div>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">Somar ao estoque</button></div>`,bg=>{
    bg.querySelector("#ok").onclick=()=>{const q=num(bg.querySelector("#e-qtd").value);if(q<=0)return close();
      save("materiais",id,{...m,quantidade:Math.round(((+m.quantidade||0)+q)*100)/100});close();toast("Estoque atualizado")}})}

const LABOR=[100,150,200,250,350,500];
const orcTotal=o=>(o.itens||[]).reduce((a,i)=>a+i.qtd*(i.preco||0),0)+(+o.maoDeObra||0);
const orcNome=o=>o.clienteId?cli(o.clienteId).nome:(o.nome||"Sem cliente");
function orcTexto(o){const L=[`Orçamento - ${orcNome(o)} (${short(o.data)})`];
  for(const i of o.itens||[])L.push(`${qfmt(i.qtd)} ${i.unidade} ${i.nome}: ${money(i.qtd*(i.preco||0))||"R$ 0,00"}`);
  if(o.maoDeObra)L.push(`Mão de obra${o.servico?" ("+o.servico+")":""}: ${money(o.maoDeObra)}`);
  L.push(`Total: ${money(orcTotal(o))||"R$ 0,00"}`);return L.join("\n")}
function renderOrcamentos(){
  const el=document.getElementById("lista-orc"),q=(document.getElementById("busca-orc").value||"").toLowerCase().trim();
  if(!S.orcamentos.size){el.innerHTML=`<div class="empty"><strong>Nenhum orçamento ainda</strong>Toque em “+ Novo orçamento”, escolha os materiais e a mão de obra e veja o total na hora.</div>`;return}
  const rows=[...S.orcamentos.entries()].map(([id,o])=>({id,...o})).filter(o=>!q||orcNome(o).toLowerCase().includes(q)).sort((a,b)=>b.data.localeCompare(a.data));
  if(!rows.length){el.innerHTML=`<div class="empty">Nenhum orçamento encontrado para “${esc(q)}”.</div>`;return}
  el.innerHTML=rows.map(o=>{const c=o.clienteId?cli(o.clienteId):{};
    return`<div class="item"><div class="when">${short(o.data)}</div><div class="body">
    <div class="line1"><strong>${esc(orcNome(o))}</strong>${c.pessoa==="PJ"?'<span class="chip">CNPJ</span>':""}${o.status==="aprovado"?'<span class="chip ok">virou serviço</span>':'<span class="chip mute">em aberto</span>'}</div>
    <div class="meta">${esc(o.servico||"")}${o.servico?" · ":""}${(o.itens||[]).length} materiais · mão de obra ${money(o.maoDeObra)||"R$ 0,00"}</div>
    <div class="line1"><strong style="font-family:var(--f-display);font-size:20px;color:var(--accent)">${money(orcTotal(o))||"R$ 0,00"}</strong></div>
    <div class="actions">${o.status!=="aprovado"?`<button class="small primary" data-act="orc-serv" data-id="${o.id}">Virar serviço</button>`:""}<button class="small" data-act="orc-ed" data-id="${o.id}">Editar</button><button class="small" data-act="orc-pdf" data-id="${o.id}">Baixar PDF</button><button class="small" data-act="orc-copy" data-id="${o.id}">Copiar texto</button><button class="small ghost" data-act="orc-del" data-id="${o.id}">Excluir</button></div></div></div>`}).join("")}
function sheetOrcamento(id){
  const o=id?S.orcamentos.get(id):{data:today(),itens:[],maoDeObra:0,servico:"Instalação"};
  const opts=[...S.clientes.entries()].sort((a,b)=>a[1].nome.localeCompare(b[1].nome,"pt-BR")).map(([cid,c])=>`<option value="${cid}" ${cid===o.clienteId?"selected":""}>${esc(c.nome)}${c.pessoa==="PJ"?" (CNPJ)":""}</option>`).join("");
  openSheet(`<h3>${id?"Editar orçamento":"Novo orçamento"}</h3>
   <div class="row"><div class="field"><label for="o-cli">Cliente</label><select id="o-cli"><option value="">Cliente ainda não cadastrado</option>${opts}</select></div>
   <div class="field" id="o-nome-f"><label for="o-nome">Nome do cliente</label><input id="o-nome" value="${esc(o.nome)}" placeholder="Opcional"></div></div>
   <div class="row"><div class="field"><label for="o-serv">Serviço</label><select id="o-serv">${TIPOS.map(t=>`<option ${t===o.servico?"selected":""}>${t}</option>`).join("")}</select></div>
   <div class="field"><label for="o-data">Data</label><input id="o-data" type="date" value="${o.data}"></div></div>
   ${MATS_FIELD("Materiais","O preço vem do cadastro do material e pode ser alterado aqui. O orçamento não mexe no estoque.")}
   <div class="field"><label for="o-mo">Mão de obra</label><div class="seg" id="o-mo-seg" style="grid-template-columns:repeat(3,minmax(0,1fr))">${LABOR.map(v=>`<button type="button" data-v="${v}" aria-pressed="${+o.maoDeObra===v}">${money(v)}</button>`).join("")}</div>
     <input id="o-mo" inputmode="decimal" placeholder="Outro valor (R$)" value="${o.maoDeObra&&!LABOR.includes(+o.maoDeObra)?String(o.maoDeObra).replace(".",","):""}"></div>
   <div class="field"><label for="o-obs">Observações / condições de pagamento</label><textarea id="o-obs" placeholder="Ex.: 50% na aprovação, restante na entrega. Garantia de 90 dias.">${esc(o.obs)}</textarea></div>
   <div class="totals"><div><span>Materiais</span><span id="t-mat"></span></div><div><span>Mão de obra</span><span id="t-mo"></span></div><div class="grand"><span>Total</span><span id="t-tot"></span></div><span class="warn-txt" id="t-warn"></span></div>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">Salvar orçamento</button></div>`,bg=>{
    let mo=+o.maoDeObra||0;
    const cs=bg.querySelector("#o-cli"),nf=bg.querySelector("#o-nome-f");const syncC=()=>nf.hidden=!!cs.value;syncC();cs.onchange=syncC;
    const calc=()=>{const it=ed.read(),m=it.reduce((a,i)=>a+i.qtd*(i.preco||0),0);
      bg.querySelector("#t-mat").textContent=money(m)||"R$ 0,00";bg.querySelector("#t-mo").textContent=money(mo)||"R$ 0,00";bg.querySelector("#t-tot").textContent=money(m+mo)||"R$ 0,00";
      const falta=it.filter(i=>i.qtd>(+S.materiais.get(i.materialId)?.quantidade||0)).map(i=>i.nome);
      bg.querySelector("#t-warn").textContent=falta.length?"Estoque insuficiente: "+falta.join(", "):""};
    const ed=matEditor(bg,o.itens,{preco:true,onChange:()=>calc()});
    const segB=bg.querySelectorAll("#o-mo-seg button"),moIn=bg.querySelector("#o-mo");
    segB.forEach(b=>b.onclick=()=>{mo=+b.dataset.v;moIn.value="";segB.forEach(x=>x.setAttribute("aria-pressed",x===b));calc()});
    moIn.oninput=()=>{mo=num(moIn.value);segB.forEach(x=>x.setAttribute("aria-pressed",false));calc()};
    calc();
    bg.querySelector("#ok").onclick=()=>{const d={...o,clienteId:cs.value||"",nome:cs.value?"":bg.querySelector("#o-nome").value.trim(),servico:bg.querySelector("#o-serv").value,data:bg.querySelector("#o-data").value||today(),itens:ed.read(),maoDeObra:mo,obs:bg.querySelector("#o-obs").value.trim()};
      d.total=orcTotal(d);save("orcamentos",id||uid(),d);close();toast("Orçamento salvo: "+(money(d.total)||"R$ 0,00"))}})}
function orcParaServico(id){const o=S.orcamentos.get(id);
  sheetServico(null,{clienteId:o.clienteId||undefined,tipo:o.servico,valor:orcTotal(o),materiais:(o.itens||[]).map(({preco,...r})=>r),obs:"Do orçamento de "+short(o.data),_novo:o.clienteId?null:{nome:o.nome}},
    ()=>save("orcamentos",id,{...o,status:"aprovado"}))}

const empresa=()=>S.config.get("empresa")||{};
function sheetEmpresa(depois){
  const e=empresa();
  openSheet(`<h3>Seus dados no PDF</h3><p class="meta">Aparecem no topo de todo orçamento em PDF.</p>
   <div class="field"><label for="e-nome">Nome da empresa</label><input id="e-nome" value="${esc(e.nome)}" placeholder="Ex.: Victor Climatização"></div>
   <div class="row"><div class="field"><label for="e-doc">CNPJ ou CPF</label><input id="e-doc" value="${esc(e.documento)}"></div>
   <div class="field"><label for="e-tel">Telefone / WhatsApp</label><input id="e-tel" inputmode="tel" value="${esc(e.telefone)}"></div></div>
   <div class="row"><div class="field"><label for="e-mail">E-mail</label><input id="e-mail" type="email" value="${esc(e.email)}"></div>
   <div class="field"><label for="e-val">Validade do orçamento (dias)</label><input id="e-val" inputmode="numeric" value="${e.validade||15}"></div></div>
   <div class="field"><label for="e-end">Endereço / cidade</label><input id="e-end" value="${esc(e.endereco)}"></div>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">${depois?"Salvar e baixar PDF":"Salvar"}</button></div>`,bg=>{
    bg.querySelector("#ok").onclick=()=>{const v=k=>bg.querySelector(k).value.trim();
      save("config","empresa",{nome:v("#e-nome"),documento:v("#e-doc"),telefone:v("#e-tel"),email:v("#e-mail"),endereco:v("#e-end"),validade:parseInt(v("#e-val"))||15});close();
      if(depois)depois();else toast("Dados salvos")}})}
let jsPDFload=null;
function loadJsPDF(){if(window.jspdf)return Promise.resolve();if(jsPDFload)return jsPDFload;
  jsPDFload=new Promise((ok,no)=>{const sc=document.createElement("script");sc.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";sc.onload=ok;sc.onerror=()=>{jsPDFload=null;no()};document.head.appendChild(sc)});return jsPDFload}
function gerarPDF(o){
  const {jsPDF}=window.jspdf,doc=new jsPDF({unit:"mm",format:"a4"}),e=empresa(),c=o.clienteId?cli(o.clienteId):{nome:o.nome||""};
  const W=210,M=16,R=W-M;let y=20;
  const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}).replace(/\u00a0/g," ");
  const fmtD=s=>{const d=parse(s);return pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear()};
  const accent=[15,111,143],ink=[20,35,44],muted=[91,109,120],line=[213,224,230];
  doc.setTextColor(...ink);doc.setFont("helvetica","bold");doc.setFontSize(17);doc.text(e.nome||"Orçamento",M,y);
  doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(...muted);
  const info=[e.documento&&((e.documento.replace(/\D/g,"").length>11?"CNPJ ":"CPF ")+e.documento),e.telefone,e.email,e.endereco].filter(Boolean);
  info.forEach((t,i)=>doc.text(t,M,y+6+i*4.5));
  const num="Nº "+o.data.replace(/-/g,"").slice(2)+"-"+(o.id||"").slice(-4).toUpperCase();
  doc.setTextColor(...accent);doc.setFont("helvetica","bold");doc.setFontSize(13);doc.text("ORÇAMENTO",R,y,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(...muted);
  doc.text(num,R,y+6,{align:"right"});doc.text("Data: "+fmtD(o.data),R,y+10.5,{align:"right"});
  doc.text("Válido até: "+fmtD(addDays(o.data,e.validade||15)),R,y+15,{align:"right"});
  y=Math.max(y+6+info.length*4.5,y+19)+4;doc.setDrawColor(...accent);doc.setLineWidth(.6);doc.line(M,y,R,y);y+=8;
  doc.setFontSize(8);doc.setTextColor(...muted);doc.text("CLIENTE",M,y);doc.text("SERVIÇO",W/2+10,y);y+=5;
  doc.setFontSize(11);doc.setTextColor(...ink);doc.setFont("helvetica","bold");doc.text(doc.splitTextToSize(c.nome||"-",W/2-M),M,y);doc.text(o.servico||"-",W/2+10,y);
  doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(...muted);
  const cl=[c.documento&&docLabel(c)+" "+c.documento,c.telefone,c.endereco,c.equipamentos&&"Equipamento: "+c.equipamentos].filter(Boolean);
  cl.forEach((t,i)=>doc.text(doc.splitTextToSize(t,W/2-M)[0],M,y+5+i*4.5));y+=8+cl.length*4.5+4;
  const cols=[{t:"Descrição",x:M},{t:"Qtd",x:118,a:"right"},{t:"Unid.",x:122},{t:"Valor unit.",x:162,a:"right"},{t:"Total",x:R,a:"right"}];
  doc.setFillColor(238,243,246);doc.rect(M,y-4.5,R-M,7,"F");doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...ink);
  cols.forEach(k=>doc.text(k.t,k.x+(k.a?-2:2),y,{align:k.a||"left"}));y+=8;doc.setFont("helvetica","normal");
  const rows=(o.itens||[]).map(i=>[i.nome,qfmt(i.qtd),i.unidade||"",brl(i.preco),brl(i.qtd*(i.preco||0))]);
  if(+o.maoDeObra)rows.push(["Mão de obra"+(o.servico?" - "+o.servico:""),"1","serv.",brl(o.maoDeObra),brl(o.maoDeObra)]);
  if(!rows.length)rows.push(["Nenhum item","","","",""]);
  for(const r of rows){if(y>265){doc.addPage();y=20}
    const desc=doc.splitTextToSize(r[0],92);doc.setTextColor(...ink);doc.text(desc,M+2,y);
    r.slice(1).forEach((v,i)=>{const k=cols[i+1];doc.text(v,k.x+(k.a?-2:2),y,{align:k.a||"left"})});
    y+=desc.length*4.5+2;doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(M,y-3,R,y-3);y+=2}
  const mat=(o.itens||[]).reduce((a,i)=>a+i.qtd*(i.preco||0),0);
  y+=2;doc.setFontSize(10);doc.setTextColor(...muted);
  doc.text("Materiais",150,y,{align:"right"});doc.text(brl(mat),R-2,y,{align:"right"});y+=5.5;
  doc.text("Mão de obra",150,y,{align:"right"});doc.text(brl(o.maoDeObra),R-2,y,{align:"right"});y+=4;
  doc.setFillColor(...accent);doc.rect(110,y,R-110,10,"F");doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("TOTAL",114,y+6.8);doc.text(brl(orcTotal(o)),R-3,y+6.8,{align:"right"});y+=20;
  if(o.obs){if(y>250){doc.addPage();y=20}doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...ink);doc.text("Observações",M,y);y+=5;
    doc.setFont("helvetica","normal");doc.setTextColor(...muted);const ob=doc.splitTextToSize(o.obs,R-M);doc.text(ob,M,y);y+=ob.length*4.5+6}
  if(y<240)y=240;doc.setDrawColor(...muted);doc.setLineWidth(.3);doc.line(M,y+12,M+75,y+12);doc.line(R-75,y+12,R,y+12);
  doc.setFontSize(8);doc.setTextColor(...muted);doc.text(e.nome||"Responsável",M,y+16);doc.text("De acordo: "+(c.nome||"cliente"),R-75,y+16);
  return doc.output("blob")}
async function baixarPDF(id,skipCheck){
  const o={id,...S.orcamentos.get(id)};
  if(!skipCheck&&!empresa().nome)return sheetEmpresa(()=>baixarPDF(id,true));
  try{await loadJsPDF()}catch(e){return toast("Não foi possível preparar o PDF. Verifique a internet e tente de novo.")}
  const nome=("Orcamento "+orcNome(o)+" "+o.data).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w\- ]+/g,"").trim()+".pdf";
  const url=URL.createObjectURL(gerarPDF(o)),a=document.createElement("a");a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);toast("PDF baixado")}

/* ---------- modais ---------- */
const root=document.getElementById("modal-root");
function openSheet(html,onMount){root.innerHTML=`<div class="sheet-bg" id="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg=document.getElementById("sheet-bg");bg.addEventListener("click",e=>{if(e.target===bg)close()});
  bg.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",close));
  const first=bg.querySelector("input,select,textarea");if(first)first.focus({preventScroll:true});
  wirePessoa(bg);onMount&&onMount(bg)}
function close(){root.innerHTML=""}
document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
function toast(msg){const d=document.createElement("div");d.className="toast";d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}

function clienteFields(c={}){const pj=c.pessoa==="PJ";return`
  <div class="field"><label>Tipo de cliente</label><div class="seg two" id="c-pessoa"><button type="button" data-p="PF" aria-pressed="${!pj}">Pessoa física (CPF)</button><button type="button" data-p="PJ" aria-pressed="${pj}">Empresa (CNPJ)</button></div></div>
  <div class="row"><div class="field"><label for="c-doc" id="c-doc-l">${pj?"CNPJ":"CPF"}</label><input id="c-doc" inputmode="numeric" value="${esc(c.documento)}" placeholder="${pj?"00.000.000/0000-00":"000.000.000-00"}"></div><div></div></div>
  <div class="field"><label for="c-nome" id="c-nome-l">${pj?"Razão social / nome da empresa":"Nome"}</label><input id="c-nome" value="${esc(c.nome)}" placeholder="Ex.: Maria Souza"></div>
  <div class="row"><div class="field"><label for="c-tel">Telefone / WhatsApp</label><input id="c-tel" inputmode="tel" value="${esc(c.telefone)}" placeholder="(11) 98888-7777"></div>
  <div class="field"><label for="c-end">Endereço / bairro</label><input id="c-end" value="${esc(c.endereco)}"></div></div>
  <div class="field"><label for="c-eq">Equipamentos</label><input id="c-eq" value="${esc(c.equipamentos)}" placeholder="Ex.: Split 12.000 BTUs sala, 9.000 quarto"></div>`}
function wirePessoa(bg){const seg=bg.querySelector("#c-pessoa");if(!seg)return;seg.querySelectorAll("button").forEach(b=>b.onclick=()=>{
  seg.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));const pj=b.dataset.p==="PJ";
  bg.querySelector("#c-doc-l").textContent=pj?"CNPJ":"CPF";bg.querySelector("#c-doc").placeholder=pj?"00.000.000/0000-00":"000.000.000-00";
  bg.querySelector("#c-nome-l").textContent=pj?"Razão social / nome da empresa":"Nome"})}
const readCliente=bg=>({pessoa:bg.querySelector('#c-pessoa [aria-pressed="true"]').dataset.p,documento:bg.querySelector("#c-doc").value.trim(),nome:bg.querySelector("#c-nome").value.trim(),telefone:bg.querySelector("#c-tel").value.trim(),endereco:bg.querySelector("#c-end").value.trim(),equipamentos:bg.querySelector("#c-eq").value.trim()});

function sheetCliente(id){
  const c=id?S.clientes.get(id):{};
  openSheet(`<h3>${id?"Editar cliente":"Novo cliente"}</h3>${clienteFields(c)}<p class="err" id="err" hidden></p>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">Salvar cliente</button></div>`,bg=>{
    bg.querySelector("#ok").onclick=()=>{const d=readCliente(bg);if(!d.nome){const e=bg.querySelector("#err");e.hidden=false;e.textContent="Informe o nome do cliente.";return}
      save("clientes",id||uid(),{...c,...d,criadoEm:c.criadoEm||today()});close();toast("Cliente salvo")}})}

function sheetServico(id,preset={},onSaved){
  const s=id?S.servicos.get(id):{tipo:"Manutenção preventiva",data:today(),hora:"",status:"agendado",...preset};
  const opts=[...S.clientes.entries()].sort((a,b)=>a[1].nome.localeCompare(b[1].nome,"pt-BR")).map(([cid,c])=>`<option value="${cid}" ${cid===s.clienteId?"selected":""}>${esc(c.nome)}</option>`).join("");
  openSheet(`<h3>${id?"Editar serviço":"Novo serviço"}</h3>
   <div class="field"><label for="v-cli">Cliente</label><select id="v-cli"><option value="__novo">+ Cadastrar novo cliente</option>${opts}</select></div>
   <div id="novo-cli">${clienteFields(preset._novo||{})}</div>
   <div class="field"><label for="v-tipo">Tipo de serviço</label><select id="v-tipo">${TIPOS.map(t=>`<option ${t===s.tipo?"selected":""}>${t}</option>`).join("")}</select></div>
   <div class="row"><div class="field"><label for="v-data">Data</label><input id="v-data" type="date" value="${s.data}"></div>
   <div class="field"><label for="v-hora">Hora</label><input id="v-hora" type="time" value="${s.hora||""}"></div></div>
   <div class="row"><div class="field"><label for="v-valor">Valor (R$)</label><input id="v-valor" inputmode="decimal" value="${s.valor||""}" placeholder="0,00"></div><div></div></div>
   ${MATS_FIELD("Material utilizado","O que você colocar aqui já sai do estoque. Se cancelar o serviço, volta para o estoque.")}
   <div class="field"><label for="v-obs">Observações</label><textarea id="v-obs">${esc(s.obs)}</textarea></div>
   <p class="err" id="err" hidden></p>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">${id&&s.status==="previsto"?"Confirmar agendamento":"Salvar na agenda"}</button></div>`,bg=>{
    const sel=bg.querySelector("#v-cli"),nc=bg.querySelector("#novo-cli");
    if(!s.clienteId&&opts&&!preset._novo)sel.value=sel.options[1].value;
    const oldMats=id&&s.status==="agendado"?(s.materiais||[]):[];
    const ed=matEditor(bg,s.materiais||[]);
    const sync=()=>nc.hidden=sel.value!=="__novo";sync();sel.onchange=sync;
    bg.querySelector("#ok").onclick=()=>{
      const err=bg.querySelector("#err"),fail=m=>{err.hidden=false;err.textContent=m};
      let cid=sel.value;
      if(cid==="__novo"){const d=readCliente(bg);if(!d.nome)return fail("Informe o nome do novo cliente.");cid=uid();save("clientes",cid,{...d,criadoEm:today()})}
      const data=bg.querySelector("#v-data").value;if(!data)return fail("Escolha a data do serviço.");
      const valor=num(bg.querySelector("#v-valor").value);
      const novos=ed.read();syncStock(oldMats,novos);
      const d2={...s,clienteId:cid,tipo:bg.querySelector("#v-tipo").value,data,hora:bg.querySelector("#v-hora").value,valor,obs:bg.querySelector("#v-obs").value.trim(),status:"agendado",materiais:novos};delete d2._novo;
      save("servicos",id||uid(),d2);onSaved&&onSaved();
      close();toast("Serviço salvo na agenda")}})}

function sheetConcluir(id){
  const s=S.servicos.get(id),c=cli(s.clienteId);let meses=6;
  const fecha=s.data>today()?today():s.data;
  openSheet(`<h3>Concluir serviço</h3><p class="meta">${esc(c.nome)} · ${esc(s.tipo)}</p>
   <div class="row"><div class="field"><label for="k-data">Feito em</label><input id="k-data" type="date" value="${fecha}"></div>
   <div class="field"><label for="k-valor">Valor cobrado (R$)</label><input id="k-valor" inputmode="decimal" value="${s.valor||""}"></div></div>
   ${MATS_FIELD("Materiais usados","Confira as quantidades. A diferença é ajustada no estoque.")}
   <div class="field"><label>Próxima manutenção</label><div class="seg" id="seg">
     <button data-m="3" aria-pressed="false">Em 3 meses</button><button data-m="6" aria-pressed="true">Em 6 meses</button><button data-m="0" aria-pressed="false">Não lembrar</button></div></div>
   <p class="meta" id="prev"></p>
   <div class="sheet-actions"><button data-close>Fechar</button><button class="primary" id="ok">Concluir</button></div>`,bg=>{
    const prev=()=>{const d=bg.querySelector("#k-data").value||today();bg.querySelector("#prev").textContent=meses?`A manutenção fica pré-agendada para ${dayTitle(addMonths(d,meses))} e aparece nos Lembretes 30 dias antes.`:"Nenhum lembrete será criado."};
    bg.querySelectorAll("#seg button").forEach(b=>b.onclick=()=>{meses=+b.dataset.m;bg.querySelectorAll("#seg button").forEach(x=>x.setAttribute("aria-pressed",x===b));prev()});
    bg.querySelector("#k-data").oninput=prev;prev();
    const ed=matEditor(bg,s.materiais||[]);
    bg.querySelector("#ok").onclick=()=>{
      const d=bg.querySelector("#k-data").value||today();
      const valor=num(bg.querySelector("#k-valor").value);
      const usados=ed.read();syncStock(s.materiais||[],usados);
      save("servicos",id,{...s,status:"concluido",data:d,valor,concluidoEm:today(),materiais:usados});
      if(meses){save("servicos",uid(),{clienteId:s.clienteId,tipo:"Manutenção preventiva",data:addMonths(d,meses),hora:"",status:"previsto",intervalo:meses,origemId:id,valor:0,obs:""})}
      close();toast(meses?`Concluído. Manutenção pré-agendada para ${short(addMonths(d,meses))}`:"Serviço concluído")}})}

function sheetConfirm(title,text,label,fn){openSheet(`<h3>${title}</h3><p>${text}</p><div class="sheet-actions"><button data-close>Voltar</button><button class="primary" id="ok">${label}</button></div>`,bg=>bg.querySelector("#ok").onclick=()=>{fn();close()})}

function sheetFicha(id){
  const c=S.clientes.get(id),mine=svcs().filter(s=>s.clienteId===id).sort(byDate).reverse();
  const lab={agendado:["agendado",""],concluido:["concluído","ok"],previsto:["pré-agendado","warn"],cancelado:["cancelado","mute"]};
  openSheet(`<h3>${esc(c.nome)}</h3><p class="meta">${c.pessoa==="PJ"?"Empresa":"Pessoa física"}${c.documento?" · "+docLabel(c)+" "+esc(c.documento):""}<br>${esc(c.telefone||"sem telefone")}${c.endereco?" · "+esc(c.endereco):""}${c.equipamentos?"<br>Equipamento: "+esc(c.equipamentos):""}</p>
   <div class="hist">${mine.length?mine.map(s=>`<div><span>${short(s.data)} · ${esc(s.tipo)}${s.valor?" · "+money(s.valor):""}${matTxt(s)?`<br><small class="meta">Materiais: ${esc(matTxt(s))}</small>`:""}</span><span class="chip ${lab[s.status][1]}">${lab[s.status][0]}</span></div>`).join(""):'<p class="meta">Nenhum serviço ainda.</p>'}</div>
   <div class="sheet-actions"><button class="ghost" id="del">Excluir cliente</button><button id="ed">Editar dados</button><button class="primary" id="ns">Novo serviço</button></div>`,bg=>{
    bg.querySelector("#ed").onclick=()=>sheetCliente(id);
    bg.querySelector("#ns").onclick=()=>sheetServico(null,{clienteId:id});
    bg.querySelector("#del").onclick=()=>sheetConfirm("Excluir cliente?",`${esc(c.nome)} e os ${mine.length} serviços dele serão apagados.`,"Excluir",()=>{mine.forEach(s=>{if(s.status==="agendado")syncStock(s.materiais,[]);remove("servicos",s.id)});remove("clientes",id);toast("Cliente excluído")})})}

/* ---------- eventos ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-act],[data-tab],[data-go]");if(!t)return;
  if(t.dataset.tab||t.dataset.go)return setTab(t.dataset.tab||t.dataset.go);
  const id=t.dataset.id,s=S.servicos.get(id);
  switch(t.dataset.act){
    case"dia":diaSel=t.dataset.dia&&t.dataset.dia!==diaSel?t.dataset.dia:null;if(tab!=="agenda")setTab("agenda");render();return;
    case"filtro":filtro=t.dataset.f;if(filtro==="concluidos"&&t.classList.contains("stat"))diaSel=null;render();if(t.classList.contains("stat"))document.querySelector("#p-agenda .days")?.scrollIntoView({behavior:"smooth",block:"start"});return;
    case"lseg":lembSeg=t.dataset.f;render();return;
    case"msg":return sheetMsg(id);
    case"admin":return sheetAdmin();
    case"empresa-dados":return sheetEmpresa();
    case"instalar":close();return instalarBtn.click();
    case"concluir":return sheetConcluir(id);
    case"editar":return sheetServico(id);
    case"agendar":return sheetServico(id);
    case"cancelar":return sheetConfirm("Cancelar serviço?",`${esc(cli(s.clienteId).nome)}, ${dayTitle(s.data).toLowerCase()}.`,"Cancelar serviço",()=>{syncStock(s.materiais,[]);save("servicos",id,{...s,status:"cancelado",materiais:[]})});
    case"dispensar":return sheetConfirm("Tirar dos lembretes?","O lembrete deste cliente sai da lista. O histórico continua na ficha dele.","Tirar da lista",()=>save("servicos",id,{...s,status:"cancelado",obs:"Cliente não quis a manutenção"}));
    case"cliente":return sheetFicha(id);
    case"entrada":return sheetEntrada(id);
    case"editmat":return sheetMaterial(id);
    case"orc-ed":return sheetOrcamento(id);
    case"orc-pdf":return baixarPDF(id);
    case"orc-serv":return orcParaServico(id);
    case"orc-copy":{const tx=orcTexto(S.orcamentos.get(id));navigator.clipboard?.writeText(tx).then(()=>toast("Orçamento copiado. Cole no WhatsApp."),()=>toast(tx));return}
    case"orc-del":return sheetConfirm("Excluir orçamento?",`Orçamento de ${esc(orcNome(S.orcamentos.get(id)))}.`,"Excluir",()=>remove("orcamentos",id));
  }});
function setTab(n){if(!TABS.includes(n))n="agenda";const mudou=tab!==n;tab=n;for(const k of TABS){document.getElementById("p-"+k).hidden=k!==n;const b=document.getElementById("tab-"+k);if(k===n)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")}
  const fl={estoque:"Cadastrar material",orcamentos:"Novo orçamento",clientes:"Novo cliente"},f=document.getElementById("fab");f.title=f.ariaLabel=fl[n]||"Novo serviço";f.setAttribute("aria-label",f.title);
  if(mudou)window.scrollTo(0,0);
  try{localStorage.setItem("agenda-clima-tab",n)}catch(e){}}
document.getElementById("fab").onclick=()=>tab==="estoque"?sheetMaterial(null):tab==="orcamentos"?sheetOrcamento(null):tab==="clientes"?sheetCliente(null):sheetServico(null);
document.getElementById("novo-orc").onclick=()=>sheetOrcamento(null);
document.getElementById("empresa").onclick=()=>sheetEmpresa();
document.getElementById("busca-orc").oninput=renderOrcamentos;
document.getElementById("novo-cliente").onclick=()=>sheetCliente(null);
document.getElementById("busca").oninput=renderClientes;
document.getElementById("busca-mat").oninput=renderEstoque;
document.getElementById("novo-mat").onclick=()=>sheetMaterial(null);
try{const t=localStorage.getItem("agenda-clima-tab");if(t)setTab(t)}catch(e){}


/* ---------- login ---------- */
const $=id=>document.getElementById(id);
let unsubs=[];
function mostrar(tela){for(const t of["auth-loading","auth-login","auth-verify","app"])$(t).hidden=t!==tela;$("fab").hidden=tela!=="app"}
function erroAuth(e){const m={"auth/invalid-email":"E-mail inválido.","auth/missing-password":"Digite a senha.","auth/weak-password":"A senha precisa de pelo menos 6 caracteres.","auth/email-already-in-use":"Já existe uma conta com este e-mail. Use Entrar ou Esqueci a senha.","auth/invalid-credential":"E-mail ou senha incorretos.","auth/wrong-password":"E-mail ou senha incorretos.","auth/user-not-found":"E-mail ou senha incorretos.","auth/too-many-requests":"Muitas tentativas. Espere alguns minutos e tente de novo.","auth/popup-closed-by-user":"","auth/cancelled-popup-request":"","auth/network-request-failed":"Sem internet. Verifique a conexão.","auth/unauthorized-domain":"Este endereço ainda não foi liberado no Firebase (Domínios autorizados)."};
  const t=e&&e.code in m?m[e.code]:"Não foi possível entrar. Tente de novo.";const el=$("auth-err");el.hidden=!t;el.textContent=t}
let modo="entrar";
function setModo(m){modo=m;$("auth-title").textContent=m==="criar"?"Criar conta":"Entrar";$("f-nome").hidden=m!=="criar";
  $("auth-submit").textContent=m==="criar"?"Criar conta":"Entrar";$("auth-switch").innerHTML=m==="criar"?'Já tem conta? <button type="button" class="link" id="sw">Entrar</button>':'Não tem conta? <button type="button" class="link" id="sw">Criar conta</button>';
  $("sw").onclick=()=>setModo(m==="criar"?"entrar":"criar");$("auth-err").hidden=true;$("esqueci").hidden=m==="criar"}
setModo("entrar");
$("google").onclick=async()=>{const p=new GoogleAuthProvider();p.setCustomParameters({prompt:"select_account"});
  try{await signInWithPopup(auth,p)}catch(e){if(e.code==="auth/popup-blocked"||e.code==="auth/operation-not-supported-in-this-environment")return signInWithRedirect(auth,p);erroAuth(e)}};
$("auth-form").onsubmit=async ev=>{ev.preventDefault();const email=$("a-email").value.trim(),senha=$("a-senha").value;$("auth-submit").disabled=true;
  try{if(modo==="criar"){const cred=await createUserWithEmailAndPassword(auth,email,senha);const nome=$("a-nome").value.trim();if(nome)await updateProfile(cred.user,{displayName:nome});await sendEmailVerification(cred.user);mostrarVerify(cred.user)}
    else await signInWithEmailAndPassword(auth,email,senha)}catch(e){erroAuth(e)}finally{$("auth-submit").disabled=false}};
$("esqueci").onclick=async()=>{const email=$("a-email").value.trim();if(!email){erroAuth({code:"auth/invalid-email"});return}
  try{await sendPasswordResetEmail(auth,email);const el=$("auth-err");el.hidden=false;el.textContent="Enviamos um link para "+email+" criar uma nova senha."}catch(e){erroAuth(e)}};
function mostrarVerify(u){$("verify-email").textContent=u.email;$("verify-msg").textContent="";mostrar("auth-verify")}
$("ja-confirmei").onclick=async()=>{await reload(auth.currentUser);await auth.currentUser.getIdToken(true);if(auth.currentUser.emailVerified)entrar(auth.currentUser);else $("verify-msg").textContent="Ainda não aparece como confirmado. Abra o link do e-mail (veja também o spam) e toque aqui de novo."};
$("reenviar").onclick=async()=>{try{await sendEmailVerification(auth.currentUser);$("verify-msg").textContent="E-mail reenviado."}catch(e){$("verify-msg").textContent=e.code==="auth/too-many-requests"?"Espere alguns minutos antes de reenviar.":"Não foi possível reenviar agora."}};
$("sair-verify").onclick=()=>signOut(auth);
$("conta").onclick=()=>sheetConta();

function entrar(u){
  if(uidAtual===u.uid)return;uidAtual=u.uid;COLS.forEach(k=>S[k].clear());carregadas=new Set();ultContagem="";salvarPerfil(u);
  nomeUser=u.displayName||"";$("user-ini").textContent=((u.displayName||u.email||"?").split(/[\s@.]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("")).toUpperCase();mostrar("app");render();
  $("storage-note").textContent="Dados salvos na sua conta. Entre com o mesmo login no celular ou computador para ver tudo.";
  unsubs=COLS.map(col=>onSnapshot(collection(fdb,"users",u.uid,col),snap=>{
    carregadas.add(col);
    for(const ch of snap.docChanges()){if(ch.type==="removed")S[col].delete(ch.doc.id);else S[col].set(ch.doc.id,{...ch.doc.data()})}
    render()},err=>{console.error(err);$("storage-note").textContent="Sem acesso aos dados agora. Recarregue a página."}))}
onAuthStateChanged(auth,u=>{
  unsubs.forEach(f=>f());unsubs=[];
  if(!u){uidAtual=null;COLS.forEach(k=>S[k].clear());close();mostrar("auth-login");return}
  const google=u.providerData.some(p=>p.providerId==="google.com");
  if(!u.emailVerified&&!google)return mostrarVerify(u);
  entrar(u)});

// ---- App instalável (PWA) ----
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(e=>console.error(e)));
const instalarBtn=document.getElementById("instalar");
const jaInstalado=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const ehIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const ehCelular=ehIOS||/android/i.test(navigator.userAgent);
let pedidoInstalar=null;
function mostrarInstalar(){instalarBtn.hidden=jaInstalado()||!(pedidoInstalar||ehCelular)}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();pedidoInstalar=e;mostrarInstalar()});
window.addEventListener("appinstalled",()=>{pedidoInstalar=null;mostrarInstalar();toast("Climatiza instalado")});
instalarBtn.onclick=async()=>{
  if(pedidoInstalar){pedidoInstalar.prompt();await pedidoInstalar.userChoice.catch(()=>{});pedidoInstalar=null;mostrarInstalar();return}
  const passos=ehIOS
    ?["Abra este site no <b>Safari</b>.","Toque no botão <b>Compartilhar</b> (o quadrado com a seta para cima).","Escolha <b>Adicionar à Tela de Início</b> e toque em <b>Adicionar</b>."]
    :["Toque nos <b>três pontinhos</b> do navegador, no canto de cima.","Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.","Confirme em <b>Instalar</b>."];
  openSheet(`<h3>Instalar o Climatiza</h3><ol class="passos">${passos.map(p=>`<li>${p}</li>`).join("")}</ol><p class="meta">Depois é só abrir pelo ícone do Climatiza, como qualquer app.</p><div class="sheet-actions"><button class="primary" data-close>Entendi</button></div>`)};
mostrarInstalar();
