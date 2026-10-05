import { NextResponse } from 'next/server';
import { createBlob, createCommit, createTree, getCommit, getRef, gh, putFile, updateRef } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

type Body = {
  phase?: 'chunk'|'finish'; owner?:string; repo?:string; branch?:string; engineId?:string; name?:string; version?:string; types?:string[];
  buildScript?:string; manifest?:Record<string,unknown>; index?:number; total?:number; content?:string; chunks?:Array<{index:number;sha:string}>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Body;
    const phase = body.phase;
    const owner = body.owner?.trim(); const repo = body.repo?.trim(); const branch = body.branch || 'main';
    if (!owner || !repo) return NextResponse.json({ok:false,error:'بيانات المستودع ناقصة.'},{status:400});
    const token = await getGithubToken();
    if (phase === 'chunk') {
      if (!body.engineId || !Number.isInteger(body.index) || !Number.isInteger(body.total) || !body.content) return NextResponse.json({ok:false,error:'بيانات جزء المحرك ناقصة.'},{status:400});
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(body.engineId)) return NextResponse.json({ok:false,error:'معرّف المحرك غير صالح.'},{status:400});
      if (body.content.length > 3800000) return NextResponse.json({ok:false,error:'جزء المحرك كبير جدًا.'},{status:413});
      const blob = await createBlob(token,owner,repo,body.content);
      return NextResponse.json({ok:true,index:body.index,sha:blob.sha,path:`engines/${body.engineId}/chunks/${String(body.index).padStart(6,'0')}.part`});
    }
    if (phase !== 'finish' || !body.engineId || !body.name || !body.chunks || body.chunks.length < 1) return NextResponse.json({ok:false,error:'بيانات تثبيت المحرك ناقصة.'},{status:400});
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(body.engineId)) return NextResponse.json({ok:false,error:'معرّف المحرك غير صالح.'},{status:400});
    const freshBase = await getRef(token,owner,repo,branch);
    const registryPath='engines/registry.json';
    let registry: {version:number;engines:Array<Record<string,unknown>>} = {version:1,engines:[]};
    try {
      const reg = await gh<{content:string}>(token,`/repos/${owner}/${repo}/contents/${registryPath}?ref=${encodeURIComponent(branch)}`);
      const decoded = Buffer.from(reg.content.replace(/\n/g,''),'base64').toString('utf8');
      registry = JSON.parse(decoded);
    } catch {}
    const entry = {id:body.engineId,name:body.name.trim().slice(0,80),version:body.version||'1.0.0',types:body.types||[],builtin:false,build_script:body.buildScript||'build.sh',manifest:body.manifest||{},total_chunks:body.chunks.length,installed_at:new Date().toISOString()};
    registry.engines = (registry.engines || []).filter(e=>e.id !== body.engineId);
    registry.engines.push(entry);
    const registryPut = await putFile(token,owner,repo,registryPath,JSON.stringify(registry,null,2),'chore: update engine registry',branch);
    const engineManifest = JSON.stringify({version:1,id:body.engineId,name:entry.name,engine_version:entry.version,types:entry.types,build_script:entry.build_script,total_chunks:entry.total_chunks,trusted_by_user:true},null,2);
    const engineBlob = await createBlob(token,owner,repo,Buffer.from(engineManifest,'utf8').toString('base64'));
    const currentRef = await getRef(token,owner,repo,branch);
    const currentCommit = await getCommit(token,owner,repo,currentRef.object.sha);
    const tree = body.chunks.slice().sort((a,b)=>a.index-b.index).map(c=>({path:`engines/${body.engineId}/chunks/${String(c.index).padStart(6,'0')}.part`,mode:'100644' as const,type:'blob' as const,sha:c.sha}));
    tree.push({path:`engines/${body.engineId}/engine.json`,mode:'100644' as const,type:'blob' as const,sha:engineBlob.sha});
    tree.push({path:`engines/registry.json`,mode:'100644' as const,type:'blob' as const,sha:registryPut.content.sha});
    const newTree=await createTree(token,owner,repo,currentCommit.tree.sha,tree);
    const newCommit=await createCommit(token,owner,repo,`engine ${body.engineId}: install`,newTree.sha,currentRef.object.sha);
    await updateRef(token,owner,repo,branch,newCommit.sha);
    return NextResponse.json({ok:true,commit_sha:newCommit.sha,base_sha:freshBase.object.sha});
  } catch(error) {
    const message=error instanceof Error?error.message:'فشل تثبيت المحرك.';
    return NextResponse.json({ok:false,error:message},{status:400});
  }
}
