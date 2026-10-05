import { NextResponse } from 'next/server';
import { ensureRepo, putFile } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';
import { WORKFLOW, WORKFLOW_PATH } from '../../../../lib/workflow';

export const runtime = 'nodejs';

const REGISTRY = {
  version: 1,
  engines: [
    { id:'android-native', name:'Android Native', version:'1.0.0', types:['android'], builtin:true },
    { id:'flutter', name:'Flutter', version:'1.0.0', types:['flutter'], builtin:true },
    { id:'capacitor', name:'Capacitor', version:'1.0.0', types:['capacitor'], builtin:true },
    { id:'webview', name:'Web → APK', version:'1.0.0', types:['web','html'], builtin:true }
  ]
};

export async function POST() {
  try {
    const token = await getGithubToken();
    const repoName = process.env.GITHUB_REPO || 'rafiki-apk-builder';
    const ensured = await ensureRepo(token, repoName);
    const owner = ensured.user.login;
    const branch = ensured.repo.default_branch || 'main';
    await putFile(token, owner, repoName, WORKFLOW_PATH, WORKFLOW, 'chore: install Rafiki Smart APK workflow', branch);
    try {
      await putFile(token, owner, repoName, 'engines/registry.json', JSON.stringify(REGISTRY, null, 2), 'chore: initialize engine registry', branch);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (!/409|422/.test(message)) throw e;
    }
    return NextResponse.json({ ok:true, owner, repo:repoName, branch, html_url:ensured.repo.html_url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل إعداد GitHub.';
    return NextResponse.json({ ok:false, error:message }, { status:400 });
  }
}
