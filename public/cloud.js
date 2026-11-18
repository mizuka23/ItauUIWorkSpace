import {clone,equal,mergeState} from './portal-merge.mjs';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {getFirestore, doc, getDoc, collection, getDocs, runTransaction, onSnapshot, serverTimestamp, setDoc} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import {firebaseConfig, administratorEmail} from './firebase-config.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
auth.languageCode="pt-BR";
const root=doc(db,'portal/main'),gate=document.querySelector('#cloud-gate'),status=document.querySelector('#cloud-status');
let user,role,revision=0,dirty=false,saving=false,blocked=false,timer,stopWatch,ready=false,lastLocal,changeCounter=0;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=s=>{status.textContent=s;};
function screen(title,text,controls=''){
  gate.hidden=false;gate.innerHTML=`<section class="cloud-card"><h1>${escape(title)}</h1><p>${escape(text)}</p>${controls}<p id="cloud-feedback" role="status" aria-live="polite"></p></section>`;
}
function feedback(text){document.querySelector('#cloud-feedback').textContent=text;}
function showError(error){
  const errors={'auth/invalid-credential':'E-mail ou senha incorretos.','auth/wrong-password':'E-mail ou senha incorretos.','auth/user-not-found':'E-mail ou senha incorretos.','auth/invalid-email':'Informe um e-mail válido.','auth/email-already-in-use':'Este e-mail já tem uma conta. Entre ou use Esqueci minha senha.','auth/weak-password':'Use uma senha com pelo menos 8 caracteres.','auth/too-many-requests':'Muitas tentativas. Aguarde alguns minutos.','auth/network-request-failed':'Verifique sua conexão e tente novamente.','auth/operation-not-allowed':'O acesso por e-mail ainda não está disponível.','permission-denied':'Sua conta ainda não tem permissão para esta operação.'};
  feedback(errors[error.code]||'Não foi possível concluir. Tente novamente.');
}
function exportLocal(){
  const blob=new Blob([JSON.stringify(lastLocal||window.cloudPortal?.getState(),null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='copia-local-nao-sincronizada.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function readSnapshot(manifest){
  const rows=await getDocs(collection(db,`snapshots/${manifest.snapshot}/chunks`));
  const chunks=rows.docs.map(d=>d.data()).sort((a,b)=>a.index-b.index);
  if(chunks.length!==manifest.chunks||chunks.some((c,i)=>c.index!==i))throw Error('A base está incompleta. Recarregue ou contate o administrador.');
  const data=JSON.parse(chunks.map(c=>c.payload).join(''));
  if(!data.meta||typeof data.meta!=='object')throw Error('Formato de base inválido.');
  return data;
}
async function commit(data,expected){
  const text=JSON.stringify(data),chunks=[];
  for(let i=0;i<text.length;i+=140000)chunks.push(text.slice(i,i+140000));
  if(chunks.length>100)throw Error('Base muito grande para esta versão. Exporte uma cópia e contate o administrador.');
  const snapshot=crypto.randomUUID();
  return runTransaction(db,async tx=>{
    const current=await tx.get(root),v=current.exists()?current.data().revision:0;
    if(v!==expected){const e=Error('CONFLICT');e.code='portal/conflict';throw e;}
    const manifest={revision:v+1,snapshot,chunks:chunks.length,updatedAt:serverTimestamp(),updatedBy:user.uid,updatedByName:user.email||user.uid};
    chunks.forEach((payload,index)=>tx.set(doc(db,`snapshots/${snapshot}/chunks/${String(index).padStart(3,'0')}`),{payload,index,createdBy:user.uid}));
    tx.set(root,manifest);
    tx.set(doc(db,`audit/${snapshot}`),{uid:user.uid,email:user.email||user.uid,at:serverTimestamp(),revision:v+1,snapshot});
    return manifest;
  });
}
const copy=clone;
let baseData=null,serverData=null,serverManifest=null,refreshing=false,remotePending=false,applying=false,conflictState=null;
let tabId=sessionStorage.getItem('itau_sync_tab');
if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('itau_sync_tab',tabId);}
const pendingKey=()=>`itau_cloud_pending_${user.uid}_${tabId}`;
const legacyKey=()=>`itau_cloud_pending_${user.uid}`;
function stash(){
  if(!user)return;
  try{
    if(dirty){localStorage.setItem(pendingKey(),JSON.stringify({baseRevision:revision,baseData,data:lastLocal}));}
    else localStorage.removeItem(pendingKey());
  }catch(error){message('Cópia no navegador indisponível. Mantenha esta aba aberta até sincronizar.');}
}
function activeEdit(){
  const el=document.activeElement;
  return !!document.querySelector('.modal-overlay.on')||!!(el?.closest('#app')&&(el.matches('input,textarea,select')||el.isContentEditable));
}
function showConflict(remote,manifest){
  const result=mergeState(baseData,lastLocal,remote);
  if(!result.conflicts.length)return false;
  blocked=true;clearTimeout(timer);conflictState={base:copy(baseData),local:copy(lastLocal),remote:copy(remote),manifest,conflicts:result.conflicts};stash();
  const preview=(value,deleted)=>deleted?'Registro removido':(typeof value==='string'?value:JSON.stringify(value)??'Campo removido').slice(0,350);
  const fields=result.conflicts.map((c,i)=>`<section style="border-top:1px solid #ddd;padding:12px 0"><strong>${escape(c.path)}</strong><p><b>Sua alteração:</b> ${escape(preview(c.local,c.localDeleted))}</p><p><b>Equipe:</b> ${escape(preview(c.remote,c.remoteDeleted))}</p><label>Qual versão deseja usar? <select data-conflict="${i}" required><option value="">Selecione</option><option value="local">Manter minha alteração</option><option value="remote">Usar alteração da equipe</option></select></label></section>`).join('');
  screen('Há alterações no mesmo campo','Suas alterações estão preservadas. Escolha a versão de cada campo em conflito; os outros campos serão combinados automaticamente.',`<form id="cloud-resolve-form" style="max-height:55vh;overflow:auto">${fields}<button type="submit">Aplicar escolhas e sincronizar</button></form><button id="cloud-backup">Salvar minha cópia</button>`);
  message('Conflito em '+result.conflicts.length+' campo(s) · aguardando sua escolha');
  document.querySelector('#cloud-backup').onclick=exportLocal;
  document.querySelector('#cloud-resolve-form').onsubmit=async e=>{
    e.preventDefault();const context=conflictState,choices={};
    document.querySelectorAll('[data-conflict]').forEach(el=>{choices[context.conflicts[Number(el.dataset.conflict)].path]=el.value;});
    const resolved=mergeState(context.base,context.local,context.remote,choices);if(resolved.conflicts.length)return;
    baseData=copy(context.remote);serverData=copy(context.remote);serverManifest=context.manifest;revision=context.manifest.revision;
    lastLocal=copy(resolved.data);dirty=!equal(lastLocal,serverData);changeCounter++;blocked=false;conflictState=null;
    gate.hidden=true;applyState(lastLocal);stash();await flush();
  };
  return true;
}
function applyState(data){
  applying=true;
  try{window.cloudPortal.replaceState(data);}finally{applying=false;}
}
function reconcile(){
  if(!ready||blocked||saving||!serverData)return;
  if(equal(lastLocal,serverData)&&!dirty){baseData=copy(serverData);message('Salvo na base da equipe');return;}
  if(activeEdit()){message(dirty?'Alterações locais · aguardando sincronização':'Atualização da equipe recebida · sua edição será preservada');return;}
  const result=mergeState(baseData,lastLocal,serverData);
  if(result.conflicts.length){showConflict(serverData,serverManifest);return;}
  const changed=!equal(lastLocal,result.data);
  lastLocal=copy(result.data);baseData=copy(serverData);
  if(changed)applyState(lastLocal);
  dirty=!equal(lastLocal,serverData);stash();
  message(dirty?'Alterações locais · aguardando sincronização':'Salvo na base da equipe');
  if(dirty&&role!=='viewer'){clearTimeout(timer);timer=setTimeout(flush,700);}
}
async function refreshRemote(){
  if(!ready||blocked||saving||refreshing)return;
  refreshing=true;remotePending=false;let failed=false;
  try{
    const current=await getDoc(root);if(!current.exists())return;
    const manifest=current.data(),data=await readSnapshot(manifest);
    // A save can finish while this read is in flight. Never move backwards.
    if(!saving&&manifest.revision>=revision){serverManifest=manifest;serverData=copy(data);revision=manifest.revision;reconcile();}
  }catch(error){failed=true;message('Sem conexão com a equipe · suas alterações pendentes continuam preservadas');remotePending=true;}
  finally{refreshing=false;if(remotePending&&!blocked&&!saving)setTimeout(refreshRemote,failed?10000:200);}
}
async function flush(){
  if(saving||blocked||!ready||role==='viewer')return;
  if(!dirty){await refreshRemote();return;}
  saving=true;clearTimeout(timer);let retryDelay=1000,failed=false;
  const counter=changeCounter,local=copy(lastLocal),baseline=copy(baseData);
  message('Salvando na base da equipe…');
  try{
    let accepted=false;
    for(let attempt=0;attempt<5;attempt++){
      const current=await getDoc(root);if(!current.exists())throw Error('Base não encontrada');
      const manifest=current.data(),remote=await readSnapshot(manifest);
      const result=mergeState(baseline,local,remote);
      if(result.conflicts.length){showConflict(remote,manifest);return;}
      try{
        const saved=equal(result.data,remote)?manifest:await commit(result.data,manifest.revision);
        revision=saved.revision;serverManifest=saved;serverData=copy(result.data);
        // The visible form may still be open. Its baseline advances only to
        // the local version acknowledged by this save, until it can be redrawn.
        baseData=copy(local);dirty=counter!==changeCounter;accepted=true;stash();break;
      }catch(error){if(error.code!=='portal/conflict')throw error;}
    }
    if(!accepted){message('Equipe salvando ao mesmo tempo · tentando novamente…');timer=setTimeout(flush,1000);return;}
    if(!dirty)localStorage.removeItem(legacyKey());
    message(dirty?'Há novas alterações para sincronizar':'Salvo na base da equipe');
  }catch(error){
    failed=true;retryDelay=10000;stash();message('Não foi possível sincronizar · alterações preservadas nesta aba. Use Sincronizar para tentar novamente.');
    timer=setTimeout(flush,10000);
  }finally{
    saving=false;
    if(!blocked){if(!failed)reconcile();if(dirty){clearTimeout(timer);timer=setTimeout(flush,retryDelay);}else if(remotePending)void refreshRemote();}
  }
}
const session={
  get email(){return user.email||user.uid;},get role(){return role;},
  persistLocal(data){
    if(role==='viewer'||!ready||applying)return;
    lastLocal=copy(data);dirty=true;changeCounter++;stash();
    message('Alterações locais · aguardando sincronização');clearTimeout(timer);timer=setTimeout(flush,1500);
  }
};
document.addEventListener('focusout',()=>setTimeout(()=>{if(!saving&&!blocked)reconcile();},150));
addEventListener('online',()=>{if(dirty)void flush();else void refreshRemote();});

function installToolbar(){
  document.querySelector('#cloud-user').textContent=user.email+' · '+({admin:'Administrador',editor:'Editor',viewer:'Somente leitura'}[role]);
  document.querySelector('#cloud-signout').onclick=async()=>{if(dirty){await flush();if(dirty||blocked)return;}await signOut(auth);location.reload();};
  document.querySelector('#cloud-sync').onclick=flush;
  const team=document.querySelector('#cloud-team');team.hidden=role!=='admin';
  team.onclick=async()=>{
    const box=document.querySelector('#cloud-members');box.hidden=!box.hidden;if(box.hidden)return;
    const rows=await getDocs(collection(db,'access'));document.querySelector('#cloud-member-list').textContent=rows.docs.map(d=>[d.id,d.data().company,({admin:'Administrador',editor:'Editor',viewer:'Somente leitura'}[d.data().role])].join(' — ')).join('\n')||'Nenhum usuário adicional cadastrado.';
  };
  document.querySelector('#cloud-member-form').onsubmit=async e=>{
    e.preventDefault();const email=document.querySelector('#cloud-member-email').value.trim().toLowerCase(),memberRole=document.querySelector('#cloud-member-role').value,company=document.querySelector('#cloud-member-company').value;
    if(email===user.email.toLowerCase()){document.querySelector('#cloud-member-feedback').textContent='Seu próprio perfil não pode ser alterado aqui.';return;}
    try{await setDoc(doc(db,'access',email),{role:memberRole,company,updatedBy:user.uid,updatedAt:serverTimestamp()});document.querySelector('#cloud-member-feedback').textContent='Acesso atualizado para '+email;}
    catch(error){document.querySelector('#cloud-member-feedback').textContent=error.message;}
  };
}
async function start(manifest){
  const data=await readSnapshot(manifest);revision=manifest.revision;
  baseData=copy(data);serverData=copy(data);serverManifest=manifest;
  document.querySelector('#ps-mode').textContent=JSON.stringify({readonly:role==='viewer'});
  window.startPortal(data,session);ready=true;lastLocal=copy(window.cloudPortal.getState());gate.hidden=true;installToolbar();
  let pending=null;
  try{pending=JSON.parse(localStorage.getItem(pendingKey())||localStorage.getItem(legacyKey())||'null');}catch(error){message('Não foi possível ler a cópia pendente deste navegador.');}
  if(pending&&!equal(pending.data,data)&&role!=='viewer'){
    lastLocal=copy(pending.data);dirty=true;
    if(pending.baseData){baseData=copy(pending.baseData);applyState(lastLocal);}
    else if(pending.baseRevision===revision){baseData=copy(data);applyState(lastLocal);}
    else{
      blocked=true;
      screen('Há uma cópia pendente da versão anterior','Exporte sua cópia antes de carregar a base da equipe. Nenhuma informação pendente foi sobrescrita.','<button id="cloud-backup">Salvar minha cópia</button><button id="cloud-load-team" disabled>Carregar base da equipe</button>');
      document.querySelector('#cloud-backup').onclick=()=>{exportLocal();document.querySelector('#cloud-load-team').disabled=false;};
      document.querySelector('#cloud-load-team').onclick=()=>{localStorage.removeItem(pendingKey());localStorage.removeItem(legacyKey());dirty=false;location.reload();};
    }
  }
  if(!blocked){dirty=!equal(lastLocal,serverData)&&role!=='viewer';reconcile();}
  stopWatch=onSnapshot(root,snapshot=>{
    if(!snapshot.exists()||snapshot.metadata.hasPendingWrites)return;
    if(snapshot.data().revision<=revision)return;
    remotePending=true;if(!saving&&!blocked)void refreshRemote();
  },error=>message('Conexão interrompida · suas alterações pendentes estão preservadas'));
}
async function bootstrap(){
  screen('Importar a base inicial','Selecione o arquivo base-inicial.json que acompanha o pacote privado de publicação. Ele será enviado ao banco protegido pelo seu login.',
    '<input id="cloud-seed" type="file" accept=".json,application/json"><button id="cloud-import">Importar base inicial</button>');
  document.querySelector('#cloud-import').onclick=async()=>{
    const file=document.querySelector('#cloud-seed').files[0];if(!file){feedback('Selecione a base inicial.');return;}
    try{const data=JSON.parse(await file.text());if(!data.meta||!data.cron?.tarefas?.length)throw Error('Selecione uma base válida do portal.');
      feedback('Importando…');await commit(data,0);location.reload();
    }catch(error){showError(error);}
  };
}
function loginScreen(mode='login'){
  const signup=mode==='signup';
  screen('Itau IU Workplace',signup?'Crie sua conta com e-mail e senha. O administrador precisa liberar seu acesso.':'Entre com seu e-mail e senha.',`
    <form id="cloud-login-form" class="cloud-login-form">
      <label for="cloud-email">E-mail</label><input id="cloud-email" name="email" type="email" autocomplete="username" required maxlength="254">
      <label for="cloud-password">Senha</label><input id="cloud-password" name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" ${signup?'minlength="8"':''} required>
      ${signup?'<label for="cloud-password-confirm">Confirme a senha</label><input id="cloud-password-confirm" type="password" autocomplete="new-password" minlength="8" required>':''}
      <button id="cloud-submit" type="submit">${signup?'Criar conta':'Entrar'}</button>
    </form>
    <button id="cloud-toggle" class="cloud-link" type="button">${signup?'Já tenho uma conta':'Criar conta'}</button>
    <button id="cloud-reset" class="cloud-link" type="button">Esqueci minha senha</button>`);
  document.querySelector('#cloud-toggle').onclick=()=>loginScreen(signup?'login':'signup');
  document.querySelector('#cloud-reset').onclick=async()=>{
    const email=document.querySelector('#cloud-email');if(!email.reportValidity())return;
    const button=document.querySelector('#cloud-reset');button.disabled=true;
    try{await sendPasswordResetEmail(auth,email.value.trim(),{url:location.origin});feedback('Se houver uma conta para este e-mail, você receberá as instruções para definir uma nova senha. Confira também o spam.');}
    catch(error){if(error.code==='auth/user-not-found')feedback('Se houver uma conta para este e-mail, você receberá as instruções.');else showError(error);}
    finally{button.disabled=false;}
  };
  document.querySelector('#cloud-login-form').onsubmit=async e=>{
    e.preventDefault();const email=document.querySelector('#cloud-email').value.trim(),password=document.querySelector('#cloud-password').value;
    if(signup&&password!==document.querySelector('#cloud-password-confirm').value){feedback('As senhas não coincidem.');return;}
    const button=document.querySelector('#cloud-submit');button.disabled=true;
    try{if(signup){await createUserWithEmailAndPassword(auth,email,password);}else await signInWithEmailAndPassword(auth,email,password);}
    catch(error){showError(error);}finally{button.disabled=false;}
  };
}
onAuthStateChanged(auth,async next=>{
  if(stopWatch)stopWatch();
  if(ready){location.reload();return;}
  user=next;
  if(!user){loginScreen();return;}
  try{
    const identity=await user.getIdTokenResult();
    if(identity.claims.firebase?.sign_in_provider!=='password'){
      screen('Entre com e-mail e senha','Use sua conta de acesso ao portal.','<button id="cloud-other">Voltar ao login</button>');
      document.querySelector('#cloud-other').onclick=()=>signOut(auth);return;
    }
    const member=await getDoc(doc(db,'access',user.email.toLowerCase()));role=member.exists()?member.data().role:null;
    if(!['admin','editor','viewer'].includes(role)){
      screen('Acesso não liberado','Peça ao administrador para liberar o e-mail '+user.email+'.','<button id="cloud-check-access">Verificar liberação</button><button id="cloud-other">Sair</button>');
      document.querySelector('#cloud-check-access').onclick=()=>location.reload();
      document.querySelector('#cloud-other').onclick=()=>signOut(auth);return;
    }
    const current=await getDoc(root);
    if(!current.exists()){if(role==='admin')await bootstrap();else screen('Base em preparação','O administrador ainda não importou a base inicial.');return;}
    await start(current.data());
  }catch(error){screen('Não foi possível conectar','Tente novamente em alguns instantes.','<button id="cloud-retry-connect">Tentar novamente</button><button id="cloud-other">Sair</button>');document.querySelector('#cloud-retry-connect').onclick=()=>location.reload();document.querySelector('#cloud-other').onclick=()=>signOut(auth);showError(error);}
});
addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
