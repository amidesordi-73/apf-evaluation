
const cfg=window.APP_CONFIG||{};
let token=sessionStorage.getItem("eval_token")||"", me=null, contacts=[], currentView="inbox";
let adminActivitySince = sessionStorage.getItem("admin_activity_since") || new Date().toISOString();
let adminActivityTimer = null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=s=>new Date(s).toLocaleString("fr-FR");
const sizeFmt=n=>n<1024?n+" o":n<1048576?(n/1024).toFixed(1)+" Ko":(n/1048576).toFixed(1)+" Mo";
function status(t){$("status").textContent=t}
async function rpc(fn,args={}){
 const r=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`,{method:"POST",headers:{apikey:cfg.SUPABASE_ANON_KEY,Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(args)});
 if(!r.ok) throw new Error((await r.text())||"Erreur serveur"); const t=await r.text(); return t?JSON.parse(t):null;
}
async function connect(){try{const rows=await rpc("eval_login",{p_username:$("u").value.trim(),p_password:$("p").value});if(!rows?.length)throw new Error("Identifiant ou mot de passe incorrect.");token=rows[0].token;sessionStorage.setItem("eval_token",token);me=rows[0];await start()}catch(e){$("loginError").textContent=e.message;$("loginError").classList.remove("hidden")}}
async function start(){if(!me){const rows=await rpc("eval_whoami",{p_token:token});if(!rows?.length){sessionStorage.clear();return}me=rows[0]}contacts=await rpc("eval_contacts_list",{p_token:token});$("login").classList.add("hidden");$("app").classList.remove("hidden");$("identity").innerHTML=`<b>${esc(me.display_name)}</b><br>${esc(me.username)}`;if(me.role==="admin"){
  $("adminBtn").classList.remove("hidden");
  $("newBtn").textContent="+ Message candidat";
  startAdminActivityWatch();
}
render(me.role==="admin"?"admin":"inbox")}
$("connect").onclick=connect;$("p").addEventListener("keydown",e=>{if(e.key==="Enter")connect()});$("logout").onclick=()=>{sessionStorage.clear();location.reload()};$("newBtn").onclick=()=>me.role==="admin"?adminCompose():compose();document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>render(b.dataset.view));

async function render(v){currentView=v;document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));const titles={inbox:"Boîte de réception",sent:"Messages envoyés",trash:"Corbeille",contacts:"Contacts",admin:"Administration"};$("title").textContent=titles[v]||v;$("content").innerHTML="<div class='muted'>Chargement…</div>";try{if(v==="inbox"||v==="sent"||v==="trash")await mailList(v);else if(v==="contacts")contactsView();else if(v==="admin")await adminView()}catch(e){$("content").innerHTML=`<div class="error">${esc(e.message)}</div>`}}

async function mailList(folder){
 if(me.role==="admin"&&folder!=="contacts"){$("content").innerHTML="<div class='card message'>Utilisez <b>Administration</b> pour contrôler les boîtes candidats.</div>";return}
 const rows=await rpc("eval_messages_list",{p_token:token,p_folder:folder});window.__rows=rows;let toolbar=folder==="trash"?`<div class="toolbar"><button class="danger" onclick="emptyTrash()">Vider la corbeille</button></div>`:"";
 if(!rows.length){$("content").innerHTML=toolbar+"<div class='card message'><span class='muted'>Aucun message.</span></div>";return}
 $("content").innerHTML=toolbar+`<div class="card mail-list">${rows.map(m=>`<div class="mail-row ${folder==="inbox"&&!m.is_read?"unread":""}" onclick="openMsg('${m.id}')"><div>${esc(m.correspondent_name)}<div class="muted">${esc(m.correspondent_email)}</div></div><div><div class="subject">${esc(m.subject||"(sans objet)")}</div><div class="muted">${esc((m.body||"").replace(/<[^>]+>/g,"").slice(0,110))}</div></div><div class="muted">${fmt(m.created_at)}</div></div>`).join("")}</div>`;
}

async function openMsg(id){
 const basic=(window.__rows||[]).find(x=>x.id===id); if(!basic)return;
 if(currentView==="inbox") try{await rpc("eval_mark_read",{p_token:token,p_message_id:id})}catch{}
 const details=(await rpc("eval_message_details",{p_token:token,p_message_id:id}))?.[0]||{};
 const atts=await rpc("eval_attachments_list",{p_token:token,p_message_id:id});
 $("title").textContent=details.subject||"(sans objet)";
 const to=(details.to_list||[]).map(x=>`${esc(x.name)} &lt;${esc(x.email)}&gt;`).join("; ");
 const cc=(details.cc_list||[]).map(x=>`${esc(x.name)} &lt;${esc(x.email)}&gt;`).join("; ");
 const bcc=(details.bcc_list||[]).map(x=>`${esc(x.name)} &lt;${esc(x.email)}&gt;`).join("; ");
 $("content").innerHTML=`<div class="card message" id="printArea">
  <div class="print-only"><h2>Messagerie Évaluation</h2></div>
  <div class="message-head"><b>De :</b> ${esc(details.sender_name)} &lt;${esc(details.sender_email)}&gt;<br>
  <b>À :</b> ${to||esc(basic.correspondent_name)}<br>${cc?`<b>CC :</b> ${cc}<br>`:""}${bcc?`<b>CCI :</b> ${bcc}<br>`:""}
  <b>Objet :</b> ${esc(details.subject||"")}<div class="muted">${fmt(details.created_at)}</div></div>
  <div class="message-body">${sanitizeRich(details.body||"")}</div>
  ${atts.length?`<div class="attachments"><b>Pièces jointes</b>${atts.map(a=>`<div class="attachment"><span>${esc(a.file_name)} <span class="muted">(${sizeFmt(a.file_size)})</span></span><button class="secondary" onclick="openAttachment('${esc(a.storage_path)}')">Ouvrir</button></div>`).join("")}</div>`:""}
  <div class="toolbar no-print" style="margin-top:18px">
   ${currentView==="inbox"&&me.role==="candidate"?`<button class="primary" onclick="replyMsg('${basic.id}')">Répondre</button>`:""}
   ${currentView!=="trash"&&me.role==="candidate"?`<button class="danger" onclick="trashMsg('${basic.id}')">Supprimer</button>`:""}
   ${currentView==="trash"&&me.role==="candidate"?`<button class="good" onclick="restoreMsg('${basic.id}')">Restaurer</button>`:""}
   <button class="secondary" onclick="window.print()">Imprimer</button>
   <button class="secondary" onclick="render('${currentView}')">Retour</button>
  </div></div>`;
}
window.openMsg=openMsg;

function sanitizeRich(s){
 const d=document.createElement("div");d.innerHTML=s;
 d.querySelectorAll("script,style,iframe,object,embed").forEach(n=>n.remove());
 d.querySelectorAll("*").forEach(el=>[...el.attributes].forEach(a=>{if(/^on/i.test(a.name))el.removeAttribute(a.name)}));
 d.querySelectorAll("a").forEach(a=>{a.target="_blank";a.rel="noopener noreferrer"});
 return d.innerHTML;
}

async function openAttachment(path){
 const url=`${cfg.SUPABASE_URL}/storage/v1/object/authenticated/eval-attachments/${encodeURI(path)}`;
 const r=await fetch(url,{headers:{apikey:cfg.SUPABASE_ANON_KEY,Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`}});
 if(!r.ok){alert("Impossible d'ouvrir la pièce jointe.");return}
 const blob=await r.blob(); const u=URL.createObjectURL(blob); window.open(u,"_blank");
}
window.openAttachment=openAttachment;

function contactsView(){$("content").innerHTML=`<div class="card mail-list contacts">${contacts.map(c=>`<div class="mail-row"><div><b>${esc(c.display_name)}</b></div><div>${esc(c.email)}</div><div>${me.role==="candidate"?`<button class="secondary" onclick="compose('${c.id}')">Écrire</button>`:""}</div></div>`).join("")}</div>`}


let recipientState = {};
let recipientSources = {};

function recipientPickerHtml(key,label,placeholder){
  return `<div class="recipient-picker-wrap">
    <label>${label}</label>
    <div class="recipient-picker">
      <div id="${key}Chips" class="recipient-chips"></div>
      <input id="${key}Input" type="text" placeholder="${placeholder}" autocomplete="off"
        oninput="recipientSearch('${key}')" onfocus="recipientSearch('${key}')" onkeydown="recipientKeyDown(event,'${key}')">
      <div id="${key}Suggest" class="recipient-suggestions hidden"></div>
    </div>
  </div>`;
}

function setupRecipientPicker(key,items,preselectedId=""){
  recipientState[key]=[];
  recipientSources[key]=items;
  if(preselectedId){
    const item=items.find(x=>x.id===preselectedId || x.username===preselectedId);
    if(item) recipientState[key].push(item);
  }
  renderRecipientChips(key);
}

function renderRecipientChips(key){
  const box=$(key+"Chips");
  if(!box) return;
  box.innerHTML=(recipientState[key]||[]).map(x=>`
    <span class="recipient-chip">
      ${esc(x.display_name||x.name)} &lt;${esc(x.email||x.username)}&gt;
      <button type="button" onclick="recipientRemove('${key}','${x.id||x.username}')">×</button>
    </span>`).join("");
}

function recipientSearch(key){
  const input=$(key+"Input"), panel=$(key+"Suggest");
  if(!input||!panel) return;
  const q=input.value.trim().toLowerCase();
  if(!q){panel.classList.add("hidden");panel.innerHTML="";return;}
  const selectedIds=new Set((recipientState[key]||[]).map(x=>x.id||x.username));
  const items=(recipientSources[key]||[])
    .filter(x=>!selectedIds.has(x.id||x.username))
    .filter(x=>((x.display_name||x.name||"")+" "+(x.email||x.username||"")).toLowerCase().includes(q))
    .slice(0,8);
  if(!items.length){panel.innerHTML=`<div class="recipient-empty">Aucun contact trouvé</div>`;panel.classList.remove("hidden");return;}
  panel.innerHTML=items.map(x=>`
    <button type="button" class="recipient-suggestion" onclick="recipientAdd('${key}','${x.id||x.username}')">
      <b>${esc(x.display_name||x.name)}</b><span>${esc(x.email||x.username)}</span>
    </button>`).join("");
  panel.classList.remove("hidden");
}

function recipientAdd(key,id){
  const item=(recipientSources[key]||[]).find(x=>(x.id||x.username)===id);
  if(!item) return;
  if(!(recipientState[key]||[]).some(x=>(x.id||x.username)===id)) recipientState[key].push(item);
  const input=$(key+"Input"); if(input) input.value="";
  const panel=$(key+"Suggest"); if(panel) panel.classList.add("hidden");
  renderRecipientChips(key);
}

function recipientRemove(key,id){
  recipientState[key]=(recipientState[key]||[]).filter(x=>(x.id||x.username)!==id);
  renderRecipientChips(key);
}

function recipientKeyDown(e,key){
  if(e.key==="Enter"){
    e.preventDefault();
    const q=$(key+"Input").value.trim().toLowerCase();
    const item=(recipientSources[key]||[]).find(x=>
      ((x.email||x.username||"").toLowerCase()===q) ||
      ((x.display_name||x.name||"").toLowerCase()===q)
    );
    if(item) recipientAdd(key,item.id||item.username);
  }
}

window.recipientSearch=recipientSearch;
window.recipientAdd=recipientAdd;
window.recipientRemove=recipientRemove;
window.recipientKeyDown=recipientKeyDown;

function compose(contactId=""){
 $("title").textContent="Nouveau message";
 $("content").innerHTML=`<div class="card message">
  ${recipientPickerHtml("to","À","Saisissez un nom ou une adresse e-mail")}
  <div class="recipient-actions"><button class="secondary small" onclick="toggleField('ccWrap')">CC</button><button class="secondary small" onclick="toggleField('bccWrap')">CCI</button></div>
  <div id="ccWrap" class="hidden">${recipientPickerHtml("cc","CC","Ajouter un destinataire en copie")}</div>
  <div id="bccWrap" class="hidden">${recipientPickerHtml("bcc","CCI","Ajouter un destinataire en copie cachée")}</div>
  <label>Objet</label><input id="subject">
  <label>Message</label>
  <div class="editor-toolbar"><button class="secondary" onclick="fmtCmd('bold')"><b>G</b></button><button class="secondary" onclick="fmtCmd('italic')"><i>I</i></button><button class="secondary" onclick="insertLink()">Insérer un lien</button></div>
  <div id="body" class="richbox" contenteditable="true"></div>
  <label>Pièces jointes</label><input id="files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.zip,.odt,.ods,.rtf">
  <div class="muted">PDF, Word, Excel, PowerPoint, images, ZIP, TXT… 10 Mo maximum par fichier.</div>
  <div class="toolbar" style="margin-top:15px"><button class="primary" onclick="sendCandidate()">Envoyer</button><button class="secondary" onclick="render('${currentView}')">Annuler</button></div>
 </div>`;
 setupRecipientPicker("to",contacts,contactId);
 setupRecipientPicker("cc",contacts);
 setupRecipientPicker("bcc",contacts);
}
window.compose=compose;
function toggleField(id){$(id).classList.toggle("hidden")}window.toggleField=toggleField;
function fmtCmd(cmd){document.execCommand(cmd,false,null)}window.fmtCmd=fmtCmd;
function insertLink(){const url=prompt("Adresse du lien (https://...)");if(url)document.execCommand("createLink",false,url)}window.insertLink=insertLink;
function selectedValues(id){return (recipientState[id]||[]).map(x=>x.id||x.username)}


async function uploadFiles(messageId){
 const files=[...($("files")?.files||[])]; 
 for(const file of files){
   if(file.size>10*1024*1024) throw new Error(`Le fichier ${file.name} dépasse 10 Mo.`);
   const path=`${messageId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
   const up=await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/eval-attachments/${encodeURI(path)}`,{
     method:"POST",headers:{apikey:cfg.SUPABASE_ANON_KEY,Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`,"Content-Type":file.type||"application/octet-stream","x-upsert":"false"},body:file
   });
   if(!up.ok)throw new Error("Échec de l'envoi de la pièce jointe "+file.name);
   await rpc("eval_add_attachment",{p_token:token,p_message_id:messageId,p_file_name:file.name,p_mime_type:file.type||"",p_file_size:file.size,p_storage_path:path});
 }
}
async function sendCandidate(){
 try{
  const to=selectedValues("to"),cc=selectedValues("cc"),bcc=selectedValues("bcc"); if(!to.length)throw new Error("Choisissez au moins un destinataire principal.");
  status("Envoi…"); const mid=await rpc("eval_send_multi",{p_token:token,p_to:to,p_cc:cc,p_bcc:bcc,p_subject:$("subject").value,p_body:$("body").innerHTML});
  await uploadFiles(mid);
  await rpc("eval_log_activity",{p_token:token,p_type:"send",p_message_id:mid,p_details:"Nouveau message envoyé"});
  status("Envoyé"); alert("Message envoyé."); render("sent");
 }catch(e){status("Erreur");alert(e.message)}
}
window.sendCandidate=sendCandidate;

async function replyMsg(id){
 const d=(await rpc("eval_message_details",{p_token:token,p_message_id:id}))?.[0];
 $("title").textContent="Répondre";
 $("content").innerHTML=`<div class="card message"><label>Votre réponse</label><div class="editor-toolbar"><button class="secondary" onclick="fmtCmd('bold')"><b>G</b></button><button class="secondary" onclick="insertLink()">Insérer un lien</button></div><div id="replyBody" class="richbox" contenteditable="true"></div><div class="toolbar" style="margin-top:15px"><button class="primary" onclick="doReply('${id}')">Envoyer</button><button class="secondary" onclick="render('inbox')">Annuler</button></div></div>`;
}
window.replyMsg=replyMsg;
async function doReply(id){
  try{
    const mid=await rpc("eval_reply",{p_token:token,p_message_id:id,p_body:$("replyBody").innerHTML});
    await rpc("eval_log_activity",{p_token:token,p_type:"send",p_message_id:mid,p_details:"Réponse envoyée"});
    alert("Réponse envoyée.");render("sent");
  }catch(e){alert(e.message)}
}
window.doReply=doReply;
async function trashMsg(id){
  if(confirm("Déplacer ce message dans la corbeille ?")){
    await rpc("eval_move_to_trash",{p_token:token,p_message_id:id});
    await rpc("eval_log_activity",{p_token:token,p_type:"delete",p_message_id:id,p_details:"Message déplacé dans la corbeille"});
    render(currentView);
  }
}
window.trashMsg=trashMsg;
async function restoreMsg(id){await rpc("eval_restore_message",{p_token:token,p_message_id:id});render("trash")}window.restoreMsg=restoreMsg;
async function emptyTrash(){
  if(confirm("Vider la corbeille ? Les messages resteront visibles par l'administrateur.")){
    await rpc("eval_empty_trash",{p_token:token});
    await rpc("eval_log_activity",{p_token:token,p_type:"empty_trash",p_message_id:null,p_details:"Corbeille vidée"});
    render("trash");
  }
}
window.emptyTrash=emptyTrash;


function etatFrancais(v){
  const map={
    inbox:"Boîte de réception",
    sent:"Messages envoyés",
    trash:"Corbeille",
    deleted:"Supprimé",
    "trash-in":"Corbeille",
    "trash-out":"Corbeille"
  };
  return map[v]||v||"—";
}

function activiteFrancais(a){
  if(a.activity_type==="send") return "a envoyé un message";
  if(a.activity_type==="delete") return "a supprimé un message";
  if(a.activity_type==="empty_trash") return "a vidé sa corbeille";
  return "a effectué une action";
}

async function startAdminActivityWatch(){
  if(adminActivityTimer) clearInterval(adminActivityTimer);
  await checkAdminActivity();
  adminActivityTimer=setInterval(checkAdminActivity,10000);
}

async function checkAdminActivity(){
  if(me?.role!=="admin") return;
  try{
    const acts=await rpc("eval_admin_activity_since",{p_token:token,p_since:adminActivitySince});
    showAdminActivityNotification(acts||[]);
  }catch(e){}
}

function showAdminActivityNotification(acts){
  let box=document.getElementById("adminActivityNotice");
  if(!box){
    box=document.createElement("div");
    box.id="adminActivityNotice";
    box.className="activity-notice hidden";
    document.body.appendChild(box);
  }
  if(!acts.length){
    box.classList.add("hidden");
    box.innerHTML="";
    return;
  }
  const last=acts[0];
  box.innerHTML=`
    <div class="activity-text">
      <b>${acts.length} nouvelle${acts.length>1?"s":""} activité${acts.length>1?"s":""}</b><br>
      ${esc(last.candidate_name)} ${activiteFrancais(last)}
    </div>
    <button class="primary small" onclick="adminRefreshFromNotice()">Actualiser</button>
  `;
  box.classList.remove("hidden");
}

async function adminRefreshFromNotice(){
  adminActivitySince=new Date().toISOString();
  sessionStorage.setItem("admin_activity_since",adminActivitySince);
  const box=document.getElementById("adminActivityNotice");
  if(box){box.classList.add("hidden");box.innerHTML="";}
  await render("admin");
}
window.adminRefreshFromNotice=adminRefreshFromNotice;

async function adminView(){
 if(me.role!=="admin")return;
 const users=await rpc("eval_users_list",{p_token:token});const msgs=await rpc("eval_admin_all_messages",{p_token:token});const cands=users.filter(u=>u.role==="candidate");window.__adminUsers=cands;window.__adminMsgs=msgs;
 $("content").innerHTML=`<div class="toolbar">
  <button class="primary" onclick="adminCompose()">Envoyer au nom d'un interlocuteur</button>
  <button class="secondary" onclick="candidateCreateForm()">+ Créer un candidat</button>
  <button class="secondary" onclick="adminRefreshFromNotice()">Actualiser</button>
  <button class="danger" onclick="resetAll()">Réinitialiser tous les messages</button>
</div>
 <h2>Comptes candidats (${cands.length})</h2><div class="grid">${cands.map(c=>`<div class="card candidate-card"><b>${esc(c.display_name)}</b><br><span class="muted">${esc(c.username)} · ${esc(c.email||"")}</span><br><span class="pill ${c.active?"":"off"}">${c.active?"Actif":"Désactivé"}</span>${c.note?`<div class="muted" style="margin-top:8px">${esc(c.note)}</div>`:""}<div class="candidate-actions"><button class="secondary small" onclick="adminOpenMailbox('${c.id}','${esc(c.display_name).replace(/'/g,"&#39;")}')">Ouvrir la boîte</button><button class="secondary small" onclick="candidateEditForm('${c.id}')">Modifier</button></div></div>`).join("")}</div>
 <h2>Contrôle de tous les échanges</h2><div class="toolbar"><input id="adminSearch" class="search" placeholder="Rechercher..." oninput="filterAdminTable()"></div>
 <div class="card admin-table"><table><thead><tr><th>Date</th><th>Candidat</th><th>Sens</th><th>Interlocuteur</th><th>Objet</th><th>État</th><th>Message</th></tr></thead><tbody id="adminRows">${msgs.map(m=>`<tr data-search="${esc((m.candidate_name+" "+m.candidate_username+" "+m.contact_name+" "+m.contact_email+" "+m.subject+" "+m.body).toLowerCase())}"><td>${fmt(m.created_at)}</td><td>${esc(m.candidate_name)}</td><td>${m.direction==="candidate_to_contact"?"Candidat → interlocuteur":"Interlocuteur → candidat"}</td><td>${esc(m.contact_name)}<div class="muted">${esc(m.contact_email)}</div></td><td><button class="secondary small" onclick="adminReadMessage('${m.id}')">${esc(m.subject||"(sans objet)")}</button></td><td>${esc(etatFrancais(m.candidate_folder))}</td><td>${esc((m.body||"").replace(/<[^>]+>/g,"").slice(0,100))}</td></tr>`).join("")}</tbody></table></div>`;
}
function filterAdminTable(){const q=$("adminSearch").value.toLowerCase();document.querySelectorAll("#adminRows tr").forEach(tr=>tr.style.display=tr.dataset.search.includes(q)?"":"none")}window.filterAdminTable=filterAdminTable;

async function adminReadMessage(id){
 const d=(await rpc("eval_message_details",{p_token:token,p_message_id:id}))?.[0]; const atts=await rpc("eval_attachments_list",{p_token:token,p_message_id:id});
 $("title").textContent="Lecture du message";
 const list=x=>(x||[]).map(y=>`${esc(y.name)} &lt;${esc(y.email)}&gt;`).join("; ");
 $("content").innerHTML=`<div class="card message" id="printArea"><div class="message-head"><b>De :</b> ${esc(d.sender_name)} &lt;${esc(d.sender_email)}&gt;<br><b>À :</b> ${list(d.to_list)}<br>${d.cc_list?.length?`<b>CC :</b> ${list(d.cc_list)}<br>`:""}${d.bcc_list?.length?`<b>CCI :</b> ${list(d.bcc_list)}<br>`:""}<b>Objet :</b> ${esc(d.subject)}<div class="muted">${fmt(d.created_at)}</div></div><div class="message-body">${sanitizeRich(d.body||"")}</div>${atts.length?`<div class="attachments"><b>Pièces jointes</b>${atts.map(a=>`<div class="attachment"><span>${esc(a.file_name)} <span class="muted">(${sizeFmt(a.file_size)})</span></span><button class="secondary" onclick="openAttachment('${esc(a.storage_path)}')">Ouvrir</button></div>`).join("")}</div>`:""}<div class="toolbar no-print" style="margin-top:18px"><button class="secondary" onclick="window.print()">Imprimer</button><button class="secondary" onclick="render('admin')">Retour</button></div></div>`;
}
window.adminReadMessage=adminReadMessage;


function adminCompose(){
 const cands=window.__adminUsers||[];
 if(!cands.length){
   rpc("eval_users_list",{p_token:token}).then(us=>{
     window.__adminUsers=us.filter(u=>u.role==="candidate"&&u.active);
     adminCompose();
   });
   return;
 }
 $("title").textContent="Nouveau message administrateur";
 const active=cands.filter(c=>c.active);
 $("content").innerHTML=`<div class="card message">
   <label>Envoyer en tant que</label>
   <select id="fromContact">${contacts.map(c=>`<option value="${c.id}">${esc(c.display_name)} — ${esc(c.email)}</option>`).join("")}</select>
   ${recipientPickerHtml("ato","À","Saisissez le nom ou l’identifiant du candidat")}
   <div class="recipient-actions"><button class="secondary small" onclick="toggleField('acc')">CC</button><button class="secondary small" onclick="toggleField('abcc')">CCI</button></div>
   <div id="acc" class="hidden">${recipientPickerHtml("accsel","CC","Ajouter un candidat en copie")}</div>
   <div id="abcc" class="hidden">${recipientPickerHtml("abccsel","CCI","Ajouter un candidat en copie cachée")}</div>
   <label>Objet</label><input id="asubject">
   <label>Message</label>
   <div class="editor-toolbar"><button class="secondary" onclick="fmtCmd('bold')"><b>G</b></button><button class="secondary" onclick="insertLinkAdmin()">Insérer un lien</button></div>
   <div id="abody" class="richbox" contenteditable="true"></div>
   <label>Pièces jointes</label><input id="afiles" type="file" multiple>
   <div class="toolbar" style="margin-top:15px"><button class="primary" onclick="adminSend()">Envoyer</button><button class="secondary" onclick="render('admin')">Annuler</button></div>
 </div>`;
 setupRecipientPicker("ato",active);
 setupRecipientPicker("accsel",active);
 setupRecipientPicker("abccsel",active);
}
window.adminCompose=adminCompose;
function insertLinkAdmin(){const url=prompt("Adresse du lien (https://...)");if(url)document.execCommand("createLink",false,url)}window.insertLinkAdmin=insertLinkAdmin;

async function adminSend(){
 try{
  const to=selectedValues("ato"),cc=selectedValues("accsel"),bcc=selectedValues("abccsel");
  if(!to.length)throw new Error("Choisissez au moins un destinataire.");
  const mid=await rpc("eval_admin_send_multi",{p_token:token,p_contact_id:$("fromContact").value,p_to:to,p_cc:cc,p_bcc:bcc,p_subject:$("asubject").value,p_body:$("abody").innerHTML});
  const af=$("afiles");
  if(af){
    const oldFiles=$("files");
    af.id="files";
    await uploadFiles(mid);
    af.id="afiles";
    if(oldFiles) oldFiles.id="files";
  }
  alert("Message envoyé.");render("admin");
 }catch(e){alert(e.message)}
}
window.adminSend=adminSend;

async function adminOpenMailbox(id,name){const rows=await rpc("eval_admin_candidate_mailbox",{p_token:token,p_candidate_id:id});$("title").textContent="Boîte de "+name;$("content").innerHTML=`<div class="toolbar"><button class="secondary" onclick="render('admin')">← Retour</button></div><div class="card mail-list">${rows.length?rows.map(m=>`<div class="mail-row" onclick="adminReadMessage('${m.id}')"><div><b>${m.direction==="out"?"À":"De"} : ${esc(m.contact_name)}</b><div class="muted">${esc(m.contact_email)}</div></div><div><div class="subject">${esc(m.subject)}</div><div class="muted">${esc((m.body||"").replace(/<[^>]+>/g,"").slice(0,120))}</div><span class="pill">${esc(etatFrancais(m.folder))}</span></div><div class="muted">${fmt(m.created_at)}</div></div>`).join(""):"<div class='message muted'>Aucun message.</div>"}</div>`}window.adminOpenMailbox=adminOpenMailbox;

function candidateCreateForm(){$("title").textContent="Créer un compte candidat";$("content").innerHTML=`<div class="card message"><div class="form-grid"><div><label>Identifiant</label><input id="cu"></div><div><label>Nom affiché</label><input id="cn"></div><div><label>Adresse affichée</label><input id="ce"></div><div><label>Mot de passe</label><input id="cp" type="text"></div></div><label>Note interne</label><input id="cno"><div class="toolbar" style="margin-top:16px"><button class="primary" onclick="createCandidate()">Créer</button><button class="secondary" onclick="render('admin')">Annuler</button></div></div>`}window.candidateCreateForm=candidateCreateForm;
async function createCandidate(){try{await rpc("eval_admin_create_candidate",{p_token:token,p_username:$("cu").value,p_display_name:$("cn").value,p_email:$("ce").value,p_password:$("cp").value,p_note:$("cno").value});alert("Compte créé.");render("admin")}catch(e){alert(e.message)}}window.createCandidate=createCandidate;
function candidateEditForm(id){const c=(window.__adminUsers||[]).find(x=>x.id===id);if(!c)return;$("title").textContent="Modifier "+c.display_name;$("content").innerHTML=`<div class="card message"><div class="form-grid"><div><label>Identifiant</label><input id="eu" value="${esc(c.username)}"></div><div><label>Nom affiché</label><input id="en" value="${esc(c.display_name)}"></div><div><label>Adresse affichée</label><input id="ee" value="${esc(c.email||"")}"></div><div><label>Nouveau mot de passe</label><input id="ep" type="text"></div></div><label>Note interne</label><input id="eno" value="${esc(c.note||"")}"><label><input id="ea" type="checkbox" style="width:auto" ${c.active?"checked":""}> Compte actif</label><div class="toolbar" style="margin-top:16px"><button class="primary" onclick="saveCandidate('${c.id}')">Enregistrer</button><button class="danger" onclick="deleteCandidate('${c.id}')">Supprimer</button><button class="secondary" onclick="render('admin')">Annuler</button></div></div>`}window.candidateEditForm=candidateEditForm;
async function saveCandidate(id){try{await rpc("eval_admin_update_candidate",{p_token:token,p_user_id:id,p_username:$("eu").value,p_display_name:$("en").value,p_email:$("ee").value,p_active:$("ea").checked,p_note:$("eno").value,p_new_password:$("ep").value||null});alert("Compte mis à jour.");render("admin")}catch(e){alert(e.message)}}window.saveCandidate=saveCandidate;
async function deleteCandidate(id){if(confirm("Supprimer ce compte ?")){try{await rpc("eval_admin_delete_candidate",{p_token:token,p_user_id:id});alert("Compte supprimé.");render("admin")}catch(e){alert(e.message)}}}window.deleteCandidate=deleteCandidate;
async function resetAll(){
  if(!confirm("Effacer définitivement TOUS les messages de TOUS les candidats ?")) return;
  try{
    status("Réinitialisation…");
    const deleted = await rpc("eval_admin_reset",{p_token:token});
    const remaining = await rpc("eval_admin_all_messages",{p_token:token});
    status("Prêt");
    if(Array.isArray(remaining) && remaining.length===0){
      alert("Réinitialisation terminée : toutes les boîtes sont vides.");
    }else{
      alert("Réinitialisation effectuée, mais "+(remaining?.length||0)+" message(s) restent visibles. Rechargez la page.");
    }
    await render("admin");
  }catch(e){
    status("Erreur");
    alert("Erreur lors de la réinitialisation : "+e.message);
  }
}
window.resetAll=resetAll;
if(token)start();
