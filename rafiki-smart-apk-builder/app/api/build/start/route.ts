import { NextResponse } from 'next/server';
import { dispatchWorkflow, gh } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

function validPackage(value:string){ return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value); }
function cleanAppName(value:string){ return value.trim().slice(0,80); }

export async function POST(request: Request) {
  try {
    const body = await request.json() as { owner?:string; repo?:string; branch?:string; buildId?:string; engineId?:string; appName?:string; packageName?:string };
    const { owner, repo, branch='main', buildId, engineId } = body;
    const appName = cleanAppName(body.appName || 'My App');
    const packageName = (body.packageName || '').trim();
    if (!owner || !repo || !buildId || !engineId || !appName || !validPackage(packageName)) return NextResponse.json({ok:false,error:'اسم الحزمة غير صالح. استخدم مثل: com.example.myapp'},{status:400});
    const token = await getGithubToken();
    const result = await dispatchWorkflow(token, owner, repo, 'build-apk.yml', branch, {
      build_id:buildId, engine_id:engineId, app_name:appName, package_name:packageName, input_manifest:`build-input/manifests/${buildId}.json`
    });
    let runId = result.workflow_run_id || null;
    let htmlUrl = result.html_url || result.run_url || null;
    if (!runId) {
      for (let i=0;i<8;i++) {
        await new Promise(r=>setTimeout(r,1500));
        const data = await gh<{workflow_runs:Array<{id:number;name:string;html_url:string;created_at:string}>}>(token, `/repos/${owner}/${repo}/actions/workflows/build-apk.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`);
        const found = data.workflow_runs.find(r => r.name.includes(buildId));
        if (found) { runId = found.id; htmlUrl = found.html_url; break; }
      }
    }
    if (!runId) return NextResponse.json({ok:false,error:'تم إرسال البناء إلى GitHub لكن لم يظهر رقم التشغيل بعد. أعد فتح الحالة بعد لحظات.'},{status:502});
    return NextResponse.json({ ok:true, run_id:runId, html_url:htmlUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر تشغيل GitHub Actions.';
    return NextResponse.json({ok:false,error:message},{status:400});
  }
}
