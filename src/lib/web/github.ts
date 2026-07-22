// ---------------------------------------------------------------------------
// web/github.ts — minimal GitHub REST client for the Website Manager (Nova).
//
// Lets the hub open pull requests against the storefront repo (tiltweb) so
// Nova's changes ship the reviewed way: edit a file on a branch, open a PR,
// a human merges. Needs GITHUB_TOKEN (contents + PR write on the repo);
// degrades cleanly (websiteRepoConfigured() === false) until it's set.
// ---------------------------------------------------------------------------
const API = "https://api.github.com";

export function websiteRepo(): string {
  return process.env.WEBSITE_REPO || "ccook029/tiltweb";
}
export function websiteBaseBranch(): string {
  return process.env.WEBSITE_BASE_BRANCH || "main";
}
export function websiteRepoConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}

async function gh(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Read a file's text + blob sha from the base branch (or a given ref). */
export async function getFile(
  path: string,
  ref = websiteBaseBranch()
): Promise<{ content: string; sha: string }> {
  const data = (await gh(
    `/repos/${websiteRepo()}/contents/${path}?ref=${encodeURIComponent(ref)}`
  )) as { content?: string; sha: string };
  const content = Buffer.from(data.content ?? "", "base64").toString("utf8");
  return { content, sha: data.sha };
}

/** SHA of the base branch tip, to branch from. */
export async function getBaseSha(): Promise<string> {
  const data = (await gh(
    `/repos/${websiteRepo()}/git/ref/heads/${encodeURIComponent(websiteBaseBranch())}`
  )) as { object: { sha: string } };
  return data.object.sha;
}

export async function createBranch(name: string, fromSha: string): Promise<void> {
  await gh(`/repos/${websiteRepo()}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
  });
}

/** Commit new content for a file on a branch (sha = the file's current blob sha). */
export async function commitFile(
  path: string,
  content: string,
  message: string,
  branch: string,
  sha: string
): Promise<void> {
  await gh(`/repos/${websiteRepo()}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      sha,
    }),
  });
}

export async function openPr(title: string, head: string, body: string): Promise<string> {
  const data = (await gh(`/repos/${websiteRepo()}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base: websiteBaseBranch(), body }),
  })) as { html_url: string };
  return data.html_url;
}
