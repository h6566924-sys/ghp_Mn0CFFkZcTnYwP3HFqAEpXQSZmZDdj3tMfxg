import { NextResponse } from 'next/server';
import { getUser } from '../../../../lib/github';
import { setGithubToken } from '../../../../lib/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string };
    const token = body.token?.trim();
    if (!token) return NextResponse.json({ ok:false, error:'أدخل مفتاح GitHub أولًا.' }, { status:400 });
    const user = await getUser(token);
    await setGithubToken(token);
    return NextResponse.json({ ok:true, login:user.login, name:user.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر التحقق من GitHub.';
    return NextResponse.json({ ok:false, error:message }, { status:400 });
  }
}
