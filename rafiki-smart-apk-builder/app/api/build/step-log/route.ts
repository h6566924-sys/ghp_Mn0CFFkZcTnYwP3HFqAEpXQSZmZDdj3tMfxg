import { NextResponse } from 'next/server';
import { getGithubToken } from '../../../../lib/session';

export const runtime='nodejs';

export async function GET(request:Request){
  try{
    const url=new URL(request.url); const owner=url.searchParams.get('owner'); const repo=url.searchParams.get('repo'); const jobId=Number(url.searchParams.get('job_id')); const step=Number(url.searchParams.get('step'));
    if(!owner||!repo||!Number.isInteger(jobId)||!Number.isInteger(step)) return NextResponse.json({ok:false,error:'بيانات السجل ناقصة.'},{status:400});
    const token=await getGithubToken();
    const res=await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/steps/${step}/logs`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'},cache:'no-store'});
    if(!res.ok) return NextResponse.json({ok:false,error:`GitHub API ${res.status}`},{status:res.status});
    const text=await res.text();
    return NextResponse.json({ok:true,text:text.slice(-30000)});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'تعذر قراءة السجل.'},{status:400});
  }
}
