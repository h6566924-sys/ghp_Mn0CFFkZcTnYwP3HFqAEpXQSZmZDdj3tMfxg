import { NextResponse } from 'next/server';
import { getGithubToken } from '../../../../lib/session';
import { getUser, getRepo } from '../../../../lib/github';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const token = await getGithubToken();
    const user = await getUser(token);
    const name = process.env.GITHUB_REPO || 'rafiki-apk-builder';
    const repo = await getRepo(token, user.login, name);
    return NextResponse.json({ ok:true, owner:user.login, repo:repo.name, branch:repo.default_branch, html_url:repo.html_url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر قراءة المستودع.';
    return NextResponse.json({ ok:false, error:message }, { status:400 });
  }
}
