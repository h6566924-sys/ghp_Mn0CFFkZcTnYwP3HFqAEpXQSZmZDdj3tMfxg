import { NextResponse } from 'next/server';
import { getGithubToken } from '../../../../lib/session';
import { getUser, getRepo } from '../../../../lib/github';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const token = await getGithubToken();
    const user = await getUser(token);
    const repoName = process.env.GITHUB_REPO || 'rafiki-apk-builder';
    let repo = null;
    try { repo = await getRepo(token, user.login, repoName); } catch {}
    return NextResponse.json({ ok:true, login:user.login, repo:repo ? { name:repo.name, full_name:repo.full_name, private:repo.private, html_url:repo.html_url, default_branch:repo.default_branch } : null });
  } catch {
    return NextResponse.json({ ok:false });
  }
}
