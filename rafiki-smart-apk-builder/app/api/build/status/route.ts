import { NextResponse } from 'next/server';
import { getArtifacts, getJobs, getReleaseByTag, getRun } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

function percent(status:string, jobs:Array<{steps?:Array<{status:string;conclusion:string|null}>}>):number {
  if (status === 'completed') return 100;
  const steps = jobs.flatMap(j=>j.steps || []);
  const finished = steps.filter(s=>s.status === 'completed').length;
  const current = steps.filter(s=>s.status === 'in_progress').length ? 1 : 0;
  return Math.min(96, Math.max(4, steps.length ? Math.round(((finished + current * .5) / steps.length) * 100) : 8));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    const runId = Number(url.searchParams.get('run_id'));
    const buildId = url.searchParams.get('build_id') || '';
    if (!owner || !repo || !Number.isInteger(runId) || runId <= 0) return NextResponse.json({ok:false,error:'رقم التشغيل غير صالح.'},{status:400});
    const token = await getGithubToken();
    const [run,jobs] = await Promise.all([getRun(token, owner, repo, runId), getJobs(token, owner, repo, runId)]);
    const jobSteps = jobs.jobs.flatMap(job=>(job.steps||[]).map(step=>({name:step.name,status:step.status,conclusion:step.conclusion,number:step.number}))); 
    const failed = jobSteps.find(s=>s.conclusion === 'failure');
    let release:null|{html_url:string;assets:Array<{name:string;browser_download_url:string;size:number}>} = null;
    if (run.status === 'completed' && run.conclusion === 'success' && buildId) {
      try { release = await getReleaseByTag(token, owner, repo, `build-${buildId}`); } catch {}
    }
    let artifacts = null;
    if (run.status === 'completed' && run.conclusion === 'success') {
      try { artifacts = await getArtifacts(token, owner, repo, runId); } catch {}
    }
    return NextResponse.json({
      ok:true,
      run:{id:run.id,status:run.status,conclusion:run.conclusion,html_url:run.html_url,name:run.name,updated_at:run.updated_at},
      progress:percent(run.status,jobs.jobs),
      steps:jobSteps,
      failed_job_id: failed ? (jobs.jobs.find(j => (j.steps || []).some(step => step.name === failed.name))?.id || null) : null,
      failed_step:failed || null,
      release:release ? {html_url:release.html_url,assets:release.assets} : null,
      artifacts:artifacts?.artifacts?.map(a=>({id:a.id,name:a.name,expired:a.expired})) || []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر قراءة حالة البناء.';
    return NextResponse.json({ok:false,error:message},{status:400});
  }
}
