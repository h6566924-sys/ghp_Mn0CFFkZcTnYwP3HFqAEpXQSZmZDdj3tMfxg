import { NextResponse } from 'next/server';
import { createCommit, createTree, getCommit, getRef, gh, putFile, updateRef } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

function validPackage(value:string){ return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value); }
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      owner?:string; repo?:string; branch?:string; buildId?:string; engineId?:string; appName?:string; packageName?:string;
      totalChunks?:number; chunks?:Array<{ index:number; sha:string }>; detectedType?:string; inputName?:string;
    };
    const { owner, repo, branch='main', buildId, engineId, appName, packageName, totalChunks, chunks, detectedType, inputName } = body;
    if (!owner || !repo || !buildId || !engineId || !appName || !validPackage(packageName || '') || !Number.isInteger(totalChunks) || !chunks || chunks.length !== totalChunks) {
      return NextResponse.json({ ok:false, error:'بيانات بناء المشروع غير مكتملة أو اسم الحزمة غير صالح.' }, { status:400 });
    }
    const unique = new Set(chunks.map(c=>c.index));
    if(unique.size!==chunks.length || chunks.some(c=>!Number.isInteger(c.index)||c.index<0||c.index>=totalChunks||!/^[0-9a-f]{40}$/.test(c.sha))) return NextResponse.json({ok:false,error:'قائمة أجزاء المشروع غير صالحة.'},{status:400});
    const token = await getGithubToken();
    const ref = await getRef(token, owner, repo, branch);
    const current = await getCommit(token, owner, repo, ref.object.sha);
    const manifestText = JSON.stringify({ version:1, build_id:buildId, engine_id:engineId, app_name:appName, package_name:packageName, total_chunks:totalChunks, detected_type:detectedType || 'unknown', input_name:inputName || 'project.zip' }, null, 2);
    const manifestPut = await putFile(token, owner, repo, `build-input/manifests/${buildId}.json`, manifestText, `build ${buildId}: manifest`, branch);
    const freshRef = await getRef(token, owner, repo, branch);
    const freshCommit = await getCommit(token, owner, repo, freshRef.object.sha);
    const tree = chunks.slice().sort((a,b)=>a.index-b.index).map((c)=>({path:`build-input/chunks/${buildId}/${String(c.index).padStart(6,'0')}.part`,mode:'100644' as const,type:'blob' as const,sha:c.sha}));
    tree.push({path:`build-input/manifests/${buildId}.json`,mode:'100644' as const,type:'blob' as const,sha:manifestPut.content.sha});
    const newTree = await createTree(token, owner, repo, freshCommit.tree.sha, tree);
    const newCommit = await createCommit(token, owner, repo, `build ${buildId}: store project input`, newTree.sha, freshRef.object.sha);
    await updateRef(token, owner, repo, branch, newCommit.sha);
    return NextResponse.json({ ok:true, commit_sha:newCommit.sha, manifest_sha:manifestPut.content.sha });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل إنهاء رفع المشروع.';
    return NextResponse.json({ ok:false, error:message }, { status:400 });
  }
}
