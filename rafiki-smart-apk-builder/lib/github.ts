const API = 'https://api.github.com';

export const GH_API_VERSION = '2026-03-10';

type Json = Record<string, unknown> | unknown[];

export async function gh<T = Json>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', GH_API_VERSION);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API}${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`GitHub API ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export function ownerRepo(repo: string, owner: string) {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(cleanOwner) || !/^[A-Za-z0-9_.-]+$/.test(cleanRepo)) {
    throw new Error('اسم الحساب أو المستودع غير صالح.');
  }
  return { owner: cleanOwner, repo: cleanRepo };
}

export async function getUser(token: string) {
  return gh<{ login: string; name: string | null; html_url: string }>(token, '/user');
}

export async function getRepo(token: string, owner: string, repo: string) {
  return gh<{ name: string; full_name: string; private: boolean; default_branch: string; html_url: string }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

export async function ensureRepo(token: string, repo: string) {
  const user = await getUser(token);
  try {
    const existing = await getRepo(token, user.login, repo);
    return { user, repo: existing };
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('GitHub API 404')) throw e;
  }
  const created = await gh<{ name: string; full_name: string; private: boolean; default_branch: string; html_url: string }>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name: repo, private: true, auto_init: true, description: 'Rafiki Smart APK Builder build repository' }),
  });
  return { user, repo: created };
}

export async function getRef(token: string, owner: string, repo: string, branch: string) {
  return gh<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
}

export async function getCommit(token: string, owner: string, repo: string, sha: string) {
  return gh<{ tree: { sha: string } }>(token, `/repos/${owner}/${repo}/git/commits/${sha}`);
}

export async function createBlob(token: string, owner: string, repo: string, contentBase64: string) {
  return gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
  });
}

export async function createTree(token: string, owner: string, repo: string, baseTree: string, tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>) {
  return gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
}

export async function createCommit(token: string, owner: string, repo: string, message: string, tree: string, parent: string) {
  return gh<{ sha: string; html_url: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree, parents: [parent] }),
  });
}

export async function updateRef(token: string, owner: string, repo: string, branch: string, sha: string) {
  return gh<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha, force: false }),
  });
}

export async function putFile(token: string, owner: string, repo: string, path: string, bodyText: string, message: string, branch: string) {
  let sha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    sha = existing.sha;
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('GitHub API 404')) throw e;
  }
  return gh<{ content: { sha: string }; commit: { sha: string } }>(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(bodyText, 'utf8').toString('base64'), branch, ...(sha ? { sha } : {}) }),
  });
}

export async function dispatchWorkflow(token: string, owner: string, repo: string, workflow: string, ref: string, inputs: Record<string,string>) {
  return gh<{ workflow_run_id?: number; run_url?: string; html_url?: string }>(token, `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export async function getRun(token: string, owner: string, repo: string, runId: number) {
  return gh<{ id: number; status: string; conclusion: string | null; html_url: string; run_started_at: string | null; updated_at: string; name: string }>(token, `/repos/${owner}/${repo}/actions/runs/${runId}`);
}

export async function getJobs(token: string, owner: string, repo: string, runId: number) {
  return gh<{ jobs: Array<{ id: number; name: string; status: string; conclusion: string | null; steps?: Array<{ name: string; status: string; conclusion: string | null; number: number }> }> }>(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
}

export async function getArtifacts(token: string, owner: string, repo: string, runId: number) {
  return gh<{ artifacts: Array<{ id: number; name: string; expired: boolean; archive_download_url: string; workflow_run: { id: number }; created_at: string }>; total_count: number }>(token, `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
}

export async function getReleaseByTag(token: string, owner: string, repo: string, tag: string) {
  return gh<{ id: number; tag_name: string; html_url: string; assets: Array<{ id: number; name: string; browser_download_url: string; size: number }> }>(token, `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
}

export async function listReleases(token: string, owner: string, repo: string) {
  return gh<Array<{ id: number; tag_name: string; name: string; html_url: string; created_at: string; assets: Array<{ id:number; name:string; browser_download_url:string; size:number }> }>>(token, `/repos/${owner}/${repo}/releases?per_page=20`);
}
