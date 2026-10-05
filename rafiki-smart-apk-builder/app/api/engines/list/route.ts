import { NextResponse } from 'next/server';
import { gh } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime='nodejs';
export async function GET(request: Request){
  try{
    const url=new URL(request.url); const owner=url.searchParams.get('owner'); const repo=url.searchParams.get('repo'); const branch=url.searchParams.get('branch')||'main';
    if(!owner||!repo) return NextResponse.json({ok:false,error:'بيانات المستودع ناقصة.'},{status:400});
    const token=await getGithubToken();
    const raw=await gh<{content:string}>(token,`/repos/${owner}/${repo}/contents/engines/registry.json?ref=${encodeURIComponent(branch)}`);
    const registry=JSON.parse(Buffer.from(raw.content.replace(/\n/g,''),'base64').toString('utf8'));
    return NextResponse.json({ok:true,registry});
  }catch(error){
    const message=error instanceof Error?error.message:'تعذر قراءة سجل المحركات.';
    return NextResponse.json({ok:false,error:message},{status:400});
  }
}
