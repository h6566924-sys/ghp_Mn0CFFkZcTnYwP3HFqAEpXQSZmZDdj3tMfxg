'use client';

import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';

type Engine = {id:string;name:string;version:string;types:string[];builtin:boolean;build_script?:string|null;total_chunks?:number};
type Step = {name:string;status:string;conclusion:string|null;number?:number};
type BuildState = {buildId:string;owner:string;repo:string;branch:string;runId?:number|null;runUrl?:string|null;appName:string;packageName:string;engineId:string;detectedType:string;inputName:string;totalChunks:number;chunks:Array<{index:number;sha:string}>;draftKey:string;status:string;progress:number;releaseUrl?:string|null;apkUrl?:string|null;createdAt:string;lastError?:string};

const DB='RafikiSmartBuilder';
const STORE='drafts';
const BUILD_KEY='rafiki_smart_build_v1';
const HISTORY_KEY='rafiki_smart_history_v1';
const CHUNK_BYTES=2.5*1024*1024;
const BUILTIN:Engine[]=[
  {id:'android-native',name:'Android Native',version:'1.0.0',types:['android'],builtin:true},
  {id:'flutter',name:'Flutter',version:'1.0.0',types:['flutter'],builtin:true},
  {id:'capacitor',name:'Capacitor',version:'1.0.0',types:['capacitor'],builtin:true},
  {id:'webview',name:'Web → APK',version:'1.0.0',types:['web','html'],builtin:true}
];

function openDB():Promise<IDBDatabase>{ return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB,1); req.onupgradeneeded=()=>req.result.createObjectStore(STORE); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function dbPut(key:string,value:Blob){const db=await openDB();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbGet(key:string):Promise<Blob|null>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(key);r.onsuccess=()=>resolve((r.result as Blob)||null);r.onerror=()=>reject(r.error);});}

function uid(){return crypto.randomUUID();}
function saveState(s:BuildState){localStorage.setItem(BUILD_KEY,JSON.stringify(s));}
function loadState():BuildState|null{try{const x=JSON.parse(localStorage.getItem(BUILD_KEY)||'null');return x&&x.buildId?x:null;}catch{return null;}}
function saveHistory(s:BuildState){const old=(()=>{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]') as BuildState[];}catch{return []}})();const next=[s,...old.filter(x=>x.buildId!==s.buildId)].slice(0,20);localStorage.setItem(HISTORY_KEY,JSON.stringify(next));}
function loadHistory():BuildState[]{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]') as BuildState[]}catch{return []}}
async function fileToBase64(blob:Blob){const buf=await blob.arrayBuffer();let out='';const bytes=new Uint8Array(buf);const size=0x8000;for(let i=0;i<bytes.length;i+=size){out+=String.fromCharCode(...bytes.subarray(i,i+size));}return btoa(out);}
async function makeZipFromFiles(files:Array<{path:string;data:string|Blob}>){const zip=new JSZip();for(const f of files){zip.file(f.path,f.data);}return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});}
async function inspectZip(file:Blob){const zip=await JSZip.loadAsync(file);const names=Object.keys(zip.files).filter(n=>!zip.files[n].dir);const shown=names.slice(0,500);let type='unknown';if(names.some(n=>/(^|\/)pubspec\.yaml$/i.test(n)))type='flutter';else if(names.some(n=>/(^|\/)capacitor\.config\.(json|ts)$/i.test(n)))type='capacitor';else if(names.some(n=>/(^|\/)(settings\.gradle|settings\.gradle\.kts|build\.gradle|build\.gradle\.kts|gradlew)$/i.test(n))&&names.some(n=>/(^|\/)AndroidManifest\.xml$/i.test(n)))type='android';else if(names.some(n=>/(^|\/)package\.json$/i.test(n)))type='web';else if(names.some(n=>/(^|\/)index\.html$/i.test(n)))type='html';return {names,shown,type};}
function engineFor(type:string,engines:Engine[]){const e=engines.find(x=>x.types.includes(type)&&x.builtin);return e||engines.find(x=>x.types.includes(type))||engines.find(x=>x.id==='webview')!;}

export default function Page(){
  const [token,setToken]=useState('');
  const [connected,setConnected]=useState(false);
  const [login,setLogin]=useState('');
  const [repo,setRepo]=useState<{owner:string;repo:string;branch:string;html_url:string}|null>(null);
  const [appName,setAppName]=useState('MyApp');
  const [packageName,setPackageName]=useState('com.example.myapp');
  const [mode,setMode]=useState<'zip'|'code'>('zip');
  const [code,setCode]=useState('');
  const [zipName,setZipName]=useState('');
  const [found,setFound]=useState<string[]>([]);
  const [detectedType,setDetectedType]=useState('unknown');
  const [engines,setEngines]=useState<Engine[]>(BUILTIN);
  const [selectedEngine,setSelectedEngine]=useState('');
  const [state,setState]=useState<BuildState|null>(()=>typeof window==='undefined'?null:loadState());
  const [history,setHistory]=useState<BuildState[]>(()=>typeof window==='undefined'?[]:loadHistory());
  const [steps,setSteps]=useState<Step[]>([]);
  const [log,setLog]=useState('');
  const [message,setMessage]=useState('جاهز.');
  const [busy,setBusy]=useState(false);
  const [engineOpen,setEngineOpen]=useState(false);
  const [engineFile,setEngineFile]=useState<File|null>(null);
  const [engineId,setEngineId]=useState('my-engine');
  const [engineName,setEngineName]=useState('محرك مخصص');
  const [engineVersion,setEngineVersion]=useState('1.0.0');
  const [engineTypes,setEngineTypes]=useState('android,flutter,web,html,capacitor');
  const [engineScript,setEngineScript]=useState('build.sh');
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{const load=async()=>{try{const r=await fetch('/api/auth/status');const x=await r.json();if(x.ok){setConnected(true);setLogin(x.login);if(x.repo){const branch=x.repo.default_branch||'main';setRepo({owner:x.login,repo:x.repo.name,branch,html_url:x.repo.html_url});await refreshEngines(x.login,x.repo.name,branch);}const saved=loadState();if(saved?.runId&&(saved.status==='running'||saved.status==='queued')){setMessage('تم العثور على بناء سابق؛ استئناف الحالة تلقائيًا…');setTimeout(()=>void poll(saved),250);}}}catch{}};void load();},[]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);

  const engine=useMemo(()=>engines.find(e=>e.id===selectedEngine)||engineFor(detectedType,engines),[engines,selectedEngine,detectedType]);

  async function connect(){setBusy(true);setMessage('جارٍ التحقق من مفتاح GitHub…');try{const r=await fetch('/api/auth/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const x=await r.json();if(!r.ok||!x.ok)throw new Error(x.error||'فشل الاتصال');setConnected(true);setLogin(x.login);setToken('');setMessage(`تم الربط بحساب ${x.login}.`);}catch(e){setMessage(e instanceof Error?e.message:'فشل الاتصال.')}finally{setBusy(false)}}

  async function setup(){setBusy(true);setMessage('جارٍ إعداد المستودع والـWorkflow تلقائيًا…');try{const r=await fetch('/api/github/setup',{method:'POST'});const x=await r.json();if(!r.ok||!x.ok)throw new Error(x.error||'فشل الإعداد');setRepo({owner:x.owner,repo:x.repo,branch:x.branch,html_url:x.html_url});setMessage('تم إعداد GitHub. يمكنك البناء الآن.');await refreshEngines(x.owner,x.repo,x.branch);}catch(e){setMessage(e instanceof Error?e.message:'فشل الإعداد.')}finally{setBusy(false)}}

  async function refreshEngines(owner=repo?.owner,repoName=repo?.repo,branch=repo?.branch){if(!owner||!repoName)return;try{const r=await fetch(`/api/engines/list?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repoName)}&branch=${encodeURIComponent(branch||'main')}`);const x=await r.json();if(x.ok&&x.registry?.engines){setEngines([...BUILTIN,...x.registry.engines.filter((e:Engine)=>!BUILTIN.some(b=>b.id===e.id))]);}}catch{}}

  async function onZip(file:File){const info=await inspectZip(file);const id=uid();const key=`draft:${id}`;await dbPut(key,file);const next:BuildState={buildId:id,owner:repo?.owner||'',repo:repo?.repo||'',branch:repo?.branch||'main',appName,packageName,engineId:engineFor(info.type,engines).id,detectedType:info.type,inputName:file.name,totalChunks:Math.ceil(file.size/CHUNK_BYTES),chunks:[],draftKey:key,status:'draft',progress:0,createdAt:new Date().toISOString()};setZipName(file.name);setFound(info.names);setDetectedType(info.type);setSelectedEngine(next.engineId);setState(next);saveState(next);saveHistory(next);setHistory(loadHistory());setMessage(`تمت قراءة ${info.names.length.toLocaleString('ar')} ملفًا فعليًا من داخل ZIP.`);}

  async function buildCode(){
    const text=code.trim();
    if(!text)throw new Error('الصق الكود أولًا.');
    if(mode==='code'&&text.includes('=== FILE:')){
      const parts=text.split(/^=== FILE:\s*(.+?)\s*===\s*$/m);const files=[];for(let i=1;i<parts.length;i+=2){const path=parts[i]?.trim();const data=parts[i+1]||'';if(path)files.push({path,data});}if(!files.length)throw new Error('لم أجد FILE markers صالحة.');const blob=await makeZipFromFiles(files);await onZip(new File([blob],'project-files.zip',{type:'application/zip'}));return;
    }
    const looksHtml=/<(!doctype html|html[\s>])/i.test(text);
    if(looksHtml){const blob=await makeZipFromFiles([{path:'index.html',data:text}]);await onZip(new File([blob],'web-code.zip',{type:'application/zip'}));return;}
    throw new Error('للكود المتعدد استخدم === FILE: path ===. الكود المنفرد المدعوم هنا هو HTML؛ للمشروع Android/Flutter الكامل استخدم ZIP أو FILE markers.');
  }

  async function selectInput(file?:File){if(!file)return;try{await onZip(file);}catch(e){setMessage(e instanceof Error?e.message:'تعذر قراءة ZIP.')}}

  async function ensureBuildRepo(){if(!connected)throw new Error('اربط GitHub أولًا.');if(!repo){await setup();const after=await (await fetch('/api/auth/status')).json();if(!after.repo)throw new Error('لم يتم العثور على المستودع بعد الإعداد.');const rr={owner:after.login,repo:after.repo.name,branch:after.repo.default_branch||'main',html_url:after.repo.html_url};setRepo(rr);return rr;}return repo;}

  async function startBuild(resume=false){
    if(resume&&state?.runId){void poll(state);return;}
    setBusy(true);setLog('');setMessage('بدء التحضير…');
    try{
      const rrepo=await ensureBuildRepo();
      let build=resume&&state?state:null;
      let blob=build?await dbGet(build.draftKey):null;
      if(!build||!blob){
        if(mode==='code')await buildCode();
        build=loadState();
        if(!build?.draftKey)throw new Error('تعذر حفظ المشروع المحلي.');
        blob=await dbGet(build.draftKey);
      }
      if(!blob)throw new Error('ملف المشروع المحفوظ غير موجود في ذاكرة الهاتف. اختره مرة أخرى.');
      const chosen=selectedEngine||engineFor(build.detectedType,engines).id;
      const total=Math.ceil(blob.size/CHUNK_BYTES);
      let next:BuildState={...build,owner:rrepo.owner,repo:rrepo.repo,branch:rrepo.branch||'main',appName,packageName,engineId:chosen,totalChunks:total,inputName:zipName||build.inputName,status:'uploading',progress:5};
      saveState(next);setState(next);saveHistory(next);setHistory(loadHistory());
      const chunks=[...next.chunks].sort((a,b)=>a.index-b.index);
      for(let i=0;i<total;i++){
        if(chunks.some(c=>c.index===i)){setMessage(`استئناف رفع المشروع: الجزء ${i+1}/${total} موجود سابقًا.`);continue;}
        const piece=blob.slice(i*CHUNK_BYTES,Math.min(blob.size,(i+1)*CHUNK_BYTES));
        const content=await fileToBase64(piece);
        setMessage(`رفع ملفات المشروع: ${i+1}/${total}`);
        const rr=await fetch('/api/build/chunk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:rrepo.owner,repo:rrepo.repo,buildId:next.buildId,index:i,total,content})});
        const xx=await rr.json();if(!rr.ok||!xx.ok)throw new Error(xx.error||'فشل رفع جزء المشروع.');
        chunks.push({index:i,sha:xx.sha});chunks.sort((a,b)=>a.index-b.index);
        next={...next,chunks:[...chunks],progress:Math.round(5+((i+1)/total)*25),status:'uploading'};
        saveState(next);setState(next);
      }
      next={...next,chunks:[...chunks],status:'finalizing',progress:34};saveState(next);setState(next);setMessage('تثبيت المشروع في GitHub…');
      const rf=await fetch('/api/build/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:rrepo.owner,repo:rrepo.repo,branch:rrepo.branch,buildId:next.buildId,engineId:chosen,appName,packageName,totalChunks:total,chunks,detectedType:next.detectedType,inputName:next.inputName})});
      const xf=await rf.json();if(!rf.ok||!xf.ok)throw new Error(xf.error||'تعذر إنهاء رفع المشروع.');
      const started={...next,status:'dispatching',progress:38};saveState(started);setState(started);setMessage('تشغيل GitHub Actions…');
      const rs=await fetch('/api/build/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:rrepo.owner,repo:rrepo.repo,branch:rrepo.branch,buildId:next.buildId,engineId:chosen,appName,packageName})});
      const xs=await rs.json();if(!rs.ok||!xs.ok||!xs.run_id)throw new Error(xs.error||'لم يبدأ GitHub Actions.');
      const running={...started,status:'running',progress:40,runId:xs.run_id,runUrl:xs.html_url};saveState(running);setState(running);saveHistory(running);setHistory(loadHistory());void poll(running);
    }catch(e){const msg=e instanceof Error?e.message:'فشل البناء.';setMessage(msg);setLog(l=>l+`\n❌ ${msg}`);setState(s=>{if(!s)return s;const x={...s,status:'error',lastError:msg};saveState(x);saveHistory(x);return x});setHistory(loadHistory());}finally{setBusy(false);}
  }

  async function poll(s:BuildState){
    const r=await fetch(`/api/build/status?owner=${encodeURIComponent(s.owner)}&repo=${encodeURIComponent(s.repo)}&run_id=${s.runId}&build_id=${encodeURIComponent(s.buildId)}`);const x=await r.json();if(!r.ok||!x.ok){setMessage(x.error||'تعذر قراءة الحالة.');timer.current=setTimeout(()=>poll(s),5000);return;}
    setSteps(x.steps||[]);const failed=x.failed_step;let newLog=(x.steps||[]).map((z:Step)=>`${z.status==='completed'?(z.conclusion==='success'?'✅':'❌'):z.status==='in_progress'?'🔵':'⚪'} ${z.name}`).join('\n');
    if(failed){try{const jobs=(x.steps||[]);const step=jobs.find((z:Step)=>z.name===failed.name);if(step){const lr=await fetch(`/api/build/step-log?owner=${encodeURIComponent(s.owner)}&repo=${encodeURIComponent(s.repo)}&job_id=${x.failed_job_id||''}&step=${Math.max(0,(step.number||1)-1)}`);if(lr.ok){const ll=await lr.json();if(ll.ok)newLog+=`\n\n--- سجل الخطوة الفاشلة ---\n${ll.text}`;}}}catch{}}
    setLog(newLog);
    if(x.run.status==='completed'){
      const done={...s,status:x.run.conclusion==='success'?'success':'failed',progress:x.run.conclusion==='success'?100:x.progress,releaseUrl:x.release?.assets?.[0]?.browser_download_url||null,apkUrl:x.release?.assets?.find((a:{name:string})=>a.name.endsWith('.apk'))?.browser_download_url||null,lastError:x.failed_step?`فشلت الخطوة: ${x.failed_step.name}`:undefined};saveState(done);saveHistory(done);setState(done);setHistory(loadHistory());setMessage(done.status==='success'?'تم البناء الحقيقي بنجاح. زر تنزيل APK أصبح جاهزًا.':`فشل البناء: ${done.lastError||x.run.conclusion}`);return;
    }
    const running={...s,status:x.run.status,progress:Math.max(40,x.progress)};saveState(running);setState(running);setMessage(x.run.status==='queued'?'البناء في قائمة GitHub…':'البناء يعمل الآن…');timer.current=setTimeout(()=>poll(running),5000);
  }

  async function addEngine(){
    if(!engineFile||!repo)throw new Error('اربط GitHub واختر ZIP للمحرك.');
    if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(engineId))throw new Error('معرّف المحرك يجب أن يكون إنجليزيًا صغيرًا مثل my-engine.');
    setBusy(true);setMessage('رفع محرك البناء وحفظه في GitHub…');try{
      const info=await inspectZip(engineFile);if(!info.names.includes('engine.json')&&!info.names.includes('build.sh'))throw new Error('محرك مخصص يجب أن يحتوي على engine.json وbuild.sh.');
      const total=Math.ceil(engineFile.size/CHUNK_BYTES);const chunks:Array<{index:number;sha:string}>=[];
      for(let i=0;i<total;i++){const content=await fileToBase64(engineFile.slice(i*CHUNK_BYTES,Math.min(engineFile.size,(i+1)*CHUNK_BYTES)));const r=await fetch('/api/engines/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'chunk',owner:repo.owner,repo:repo.repo,branch:repo.branch,engineId,index:i,total,content})});const x=await r.json();if(!r.ok||!x.ok)throw new Error(x.error||'فشل رفع جزء المحرك.');chunks.push({index:i,sha:x.sha});setMessage(`رفع المحرك: ${i+1}/${total}`);}
      const types=engineTypes.split(',').map(x=>x.trim()).filter(Boolean);const r=await fetch('/api/engines/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'finish',owner:repo.owner,repo:repo.repo,branch:repo.branch,engineId,name:engineName,version:engineVersion,types,buildScript:engineScript,chunks,manifest:{trusted:true}})});const x=await r.json();if(!r.ok||!x.ok)throw new Error(x.error||'فشل تثبيت المحرك.');
      setEngineOpen(false);setEngineFile(null);await refreshEngines();setSelectedEngine(engineId);setMessage('تم حفظ المحرك داخل GitHub وسيظهر بعد إعادة فتح الموقع.');
    }catch(e){setMessage(e instanceof Error?e.message:'فشل تثبيت المحرك.')}finally{setBusy(false)}
  }

  const statusText=state?.status||'لا يوجد بناء';
  return <div className="wrap">
    <div className="top"><div><div className="brand">🧠 محرك رفيقي الذكي لبناء APK</div><div className="sub">تحليل فعلي • GitHub Actions • محركات قابلة للإضافة • حفظ واستئناف</div></div><div className="badge">{connected?`GitHub: ${login}`:'GitHub غير مربوط'}</div></div>
    <div className="grid">
      <main className="card">
        <div className="title">1) المشروع</div>
        <div className="btnrow" style={{marginBottom:10}}><button className={`btn ${mode==='zip'?'primary':''}`} onClick={()=>setMode('zip')}>📦 ZIP كامل</button><button className={`btn ${mode==='code'?'primary':''}`} onClick={()=>setMode('code')}>⌨️ كود مباشر</button></div>
        {mode==='zip'?<div className="drop"><input id="zip" type="file" accept=".zip,application/zip" onChange={e=>selectInput(e.target.files?.[0])}/><label className="filebtn" htmlFor="zip">اختيار ZIP</label><div className="small muted" style={{marginTop:8}}>{zipName||'أي ملفات داخل ZIP مقبولة: صور، صوت، فيديو، كود، JSON…'}</div></div>:<div><textarea className="textarea" value={code} onChange={e=>setCode(e.target.value)} placeholder={'للمشاريع المتعددة:\n=== FILE: app/src/main/... ===\n...\n=== FILE: ... ===\n\nولصفحة ويب واحدة الصق HTML مباشرة.'}/><div className="btnrow" style={{marginTop:8}}><button className="btn primary" onClick={()=>buildCode().catch(e=>setMessage(e instanceof Error?e.message:'خطأ'))}>تحويل الكود إلى ZIP</button></div></div>}
        <div className="row" style={{marginTop:12}}><div className="field"><label>اسم التطبيق</label><input className="input" value={appName} onChange={e=>setAppName(e.target.value)}/></div><div className="field"><label>Package / Application ID</label><input className="input" value={packageName} onChange={e=>setPackageName(e.target.value)}/></div></div>
        <div className="field"><label>المحرك الذي سيُستخدم</label><select value={selectedEngine||engine.id} onChange={e=>setSelectedEngine(e.target.value)}>{engines.map(e=><option key={e.id} value={e.id}>{e.name} — {e.types.join(', ')}</option>)}</select></div>
        {found.length>0&&<><div className="title" style={{marginTop:8}}>الملفات الموجودة فعليًا</div><div className="notice">اكتشف الموقع النوع من الأسماء الموجودة داخل ZIP فقط. لن يطلب ملفًا غير موجود لمجرد أنه شائع في نوع المشروع.</div><div className="found" style={{marginTop:8}}>{found.slice(0,500).map((n,i)=><div key={`${n}-${i}`}>{n}</div>)}{found.length>500&&<div>… وتم العثور على {found.length.toLocaleString('ar')} ملفًا.</div>}</div></>}
        <div className="title" style={{marginTop:14}}>2) البناء الحقيقي</div>
        <div className="progress"><div className="bar" style={{width:`${state?.progress||0}%`}}/></div><div className="status">{message} <span className="muted">({state?.progress||0}%)</span></div>
        <div className="steps" style={{marginTop:10}}>{steps.map((s,i)=><div className="step" key={`${s.name}-${i}`}><b>{s.name}</b><span>{s.status==='completed'?(s.conclusion==='success'?'✅':'❌'):s.status==='in_progress'?'🔵':'⚪'}</span></div>)}</div>
        <div className="log" style={{marginTop:10}}>{log||'ستظهر هنا خطوات GitHub Actions الفعلية وحالة كل خطوة.'}</div>
        <div className="btnrow" style={{marginTop:10}}><button className="btn primary" disabled={busy||!connected} onClick={()=>startBuild(false)}>🚀 تحويل إلى APK</button><button className="btn" disabled={busy||!state?.runId} onClick={()=>state&&poll(state)}>🔄 تحديث الحالة</button>{state?.runId&&<a className="btn" href={state.runUrl||'#'} target="_blank" rel="noreferrer">فتح GitHub Actions</a>}{state?.apkUrl&&<a className="btn primary" href={state.apkUrl} target="_blank" rel="noreferrer">📥 تنزيل APK</a>}</div>
        {state?.status==='success'&&<div className="notice" style={{marginTop:10}}>✅ تم إنتاج APK حقيقي. رابط الإصدار محفوظ في حالة البناء، ولن يختفي لمجرد إغلاق الصفحة.</div>}
        {state?.status==='failed'&&<div className="notice danger" style={{marginTop:10}}>❌ البناء فشل. الموقع يعرض الخطوة الفاشلة بدل اختراع ملف ناقص أو نجاح وهمي.</div>}
      </main>
      <aside>
        <div className="card">
          <div className="title">GitHub — إعداد مرة واحدة</div>
          {connected?<div className="notice ok">✅ متصل بحساب <b>{login}</b></div>:<><div className="field"><label>مفتاح GitHub</label><input className="input" type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="الصقه هنا، ولن يظهر في الكود"/></div><button className="btn primary" disabled={busy||!token} onClick={connect}>حفظ والتحقق</button></>}
          <div className="btnrow" style={{marginTop:8}}><button className="btn" disabled={busy||!connected} onClick={setup}>⚙️ تجهيز المستودع تلقائيًا</button>{repo&&<a className="btn" href={repo.html_url} target="_blank" rel="noreferrer">المستودع</a>}</div>
          <div className="small muted" style={{marginTop:8}}>المفتاح محفوظ في جلسة مشفرة HttpOnly على الخادم، وليس localStorage ولا داخل JavaScript.</div>
        </div>
        <div className="card" style={{marginTop:14}}>
          <div className="title">🧩 محركات البناء</div>
          {engines.map(e=><div className="engine" key={e.id}><div><b>{e.name}</b><div className="small muted">{e.version} • {e.types.join(' / ')}</div></div><span className="small">{e.builtin?'مدمج':'مضاف'}</span></div>)}
          <button className="btn primary" disabled={!repo||busy} onClick={()=>setEngineOpen(true)}>➕ إضافة محرك</button>
        </div>
        <div className="card" style={{marginTop:14}}>
          <div className="title">💾 استئناف وحفظ</div><div className="notice">البناء الحالي: <b>{statusText}</b><br/>المشروع نفسه محفوظ داخل IndexedDB. حالة GitHub محفوظة في الجهاز، لذلك إعادة فتح الموقع تعيدك لآخر بناء.</div>
          {state?.status==='running'&&<button className="btn primary" style={{marginTop:8}} onClick={()=>poll(state)}>▶ متابعة البناء</button>}
        </div>
        <div className="card" style={{marginTop:14}}><div className="title">📚 آخر عمليات البناء</div><div className="history">{history.length?history.map(h=><div className="historyItem" key={h.buildId}><b>{h.appName}</b><div className="small muted">{h.engineId} • {new Date(h.createdAt).toLocaleString('ar')}</div><div className="small">{h.status} {h.runId?`• #${h.runId}`:''}</div>{h.apkUrl&&<a className="link" href={h.apkUrl} target="_blank" rel="noreferrer">تنزيل APK</a>}</div>):<div className="muted small">لا توجد عمليات محفوظة بعد.</div>}</div></div>
      </aside>
    </div>
    <div className="footer">النسخة تستخدم GitHub Actions للبناء الحقيقي. لا يمكن للمتصفح وحده تشغيل Android SDK/Gradle كاملًا.</div>

    {engineOpen&&<div style={{position:'fixed',inset:0,background:'#0009',display:'grid',placeItems:'center',padding:15,zIndex:20}}><div className="card" style={{width:'min(620px,100%)',maxHeight:'90vh',overflow:'auto'}}><div className="title">إضافة محرك بناء</div><div className="notice">ZIP المحرك يجب أن يحتوي <b>engine.json</b> و <b>build.sh</b>. المحرك المخصص يُنفَّذ داخل GitHub Actions في مستودعك.</div><div className="row" style={{marginTop:10}}><div className="field"><label>المعرّف</label><input className="input" value={engineId} onChange={e=>setEngineId(e.target.value)}/></div><div className="field"><label>الاسم</label><input className="input" value={engineName} onChange={e=>setEngineName(e.target.value)}/></div></div><div className="row"><div className="field"><label>الإصدار</label><input className="input" value={engineVersion} onChange={e=>setEngineVersion(e.target.value)}/></div><div className="field"><label>الأنواع المدعومة</label><input className="input" value={engineTypes} onChange={e=>setEngineTypes(e.target.value)}/></div></div><div className="field"><label>السكربت</label><input className="input" value={engineScript} onChange={e=>setEngineScript(e.target.value)}/></div><div className="drop"><input id="engine" type="file" accept=".zip,application/zip" onChange={e=>setEngineFile(e.target.files?.[0]||null)}/><label className="filebtn" htmlFor="engine">اختيار ZIP المحرك</label><div className="small muted" style={{marginTop:8}}>{engineFile?.name||'لم يتم اختيار محرك'}</div></div><div className="btnrow" style={{marginTop:10}}><button className="btn primary" disabled={busy||!engineFile} onClick={()=>addEngine().catch(e=>setMessage(e instanceof Error?e.message:'خطأ'))}>حفظ المحرك</button><button className="btn" disabled={busy} onClick={()=>setEngineOpen(false)}>إلغاء</button></div></div></div>}
  </div>;
}
