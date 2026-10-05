import { NextResponse } from 'next/server';
import { createBlob } from '../../../../lib/github';
import { getGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { owner?: string; repo?: string; buildId?: string; index?: number; total?: number; content?: string };
    const { owner, repo, buildId, index, total, content } = body;
    if (!owner || !repo || !buildId || !Number.isInteger(index) || !Number.isInteger(total) || !content) {
      return NextResponse.json({ ok:false, error:'بيانات جزء الملف غير مكتملة.' }, { status:400 });
    }
    if (!/^[a-f0-9-]{20,64}$/.test(buildId)) return NextResponse.json({ ok:false, error:'معرّف البناء غير صالح.' }, { status:400 });
    if (index < 0 || index >= total || total < 1 || total > 1000) return NextResponse.json({ ok:false, error:'ترقيم أجزاء الملف غير صالح.' }, { status:400 });
    if (content.length > 3800000) return NextResponse.json({ ok:false, error:'الجزء كبير جدًا لإرساله بأمان عبر Vercel. صغّر حجم الجزء.' }, { status:413 });
    const token = await getGithubToken();
    const blob = await createBlob(token, owner, repo, content);
    return NextResponse.json({ ok:true, index, sha:blob.sha, path:`build-input/chunks/${buildId}/${String(index).padStart(6,'0')}.part` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل رفع جزء من المشروع.';
    return NextResponse.json({ ok:false, error:message }, { status:400 });
  }
}
