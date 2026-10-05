import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE = 'rafiki_github_session';

function key(): any {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET غير مضبوط أو قصير جدًا.');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(value: string): string {
  const [ivB64, tagB64, dataB64] = value.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('جلسة GitHub غير صالحة.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

export async function getGithubToken(): Promise<string> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) throw new Error('لم يتم ربط GitHub بعد.');
  return decryptToken(value);
}

export async function setGithubToken(token: string) {
  const store = await cookies();
  store.set(COOKIE, encryptToken(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearGithubToken() {
  const store = await cookies();
  store.delete(COOKIE);
}
