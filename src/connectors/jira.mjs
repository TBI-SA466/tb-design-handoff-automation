import { httpJson } from '../lib/http.mjs';

function base() {
  const b = process.env.JIRA_BASE_URL;
  if (!b) throw new Error('JIRA_BASE_URL is required');
  return b.replace(/\/+$/, '');
}

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN are required');
  const basic = Buffer.from(`${email}:${token}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${basic}` };
}

export async function jiraGetIssue(key) {
  const url = new URL(`${base()}/rest/api/3/issue/${key}`);
  url.searchParams.set('fields', 'summary,description,status,labels,attachment');
  return httpJson(url.toString(), { headers: authHeader() });
}

export async function jiraSearchJql(jql, { maxResults = 25 } = {}) {
  const url = new URL(`${base()}/rest/api/3/search/jql`);
  url.searchParams.set('jql', jql);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('fields', 'summary,description,status');
  return httpJson(url.toString(), { headers: authHeader() });
}

/**
 * Returns issue keys of all issues that belong to the given Epic.
 * JQL used: EPIC_CHILD_JQL env (with {epicKey} replaced) or default "parent = <epicKey>".
 * For classic "Epic Link" field use e.g. EPIC_CHILD_JQL='"Epic Link" = {epicKey}'
 */
export async function jiraGetIssueKeysInEpic(epicKey, { maxResults = 100 } = {}) {
  const template = process.env.EPIC_CHILD_JQL || 'parent = {epicKey}';
  const jql = template.replace(/{epicKey}/g, epicKey);
  const res = await jiraSearchJql(jql, { maxResults });
  const issues = res.issues || [];
  return issues.map((i) => i.key);
}

export async function jiraAddComment(key, commentText) {
  const url = `${base()}/rest/api/3/issue/${key}/comment`;
  return httpJson(url, {
    method: 'POST',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: commentText }],
          },
        ],
      },
    }),
  });
}

export async function jiraAddCommentAdf(key, adf) {
  const url = `${base()}/rest/api/3/issue/${key}/comment`;
  return httpJson(url, {
    method: 'POST',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: adf }),
  });
}

export async function jiraUpdateIssueDescription(key, descriptionAdf) {
  const url = `${base()}/rest/api/3/issue/${key}`;
  return httpJson(url, {
    method: 'PUT',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: {
        description: descriptionAdf,
      },
    }),
  });
}

export async function jiraUpdateIssueLabels(key, labels) {
  const url = `${base()}/rest/api/3/issue/${key}`;
  return httpJson(url, {
    method: 'PUT',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: {
        labels,
      },
    }),
  });
}

export async function jiraAddAttachments(key, files) {
  // Jira attachments endpoint requires multipart/form-data and:
  // - X-Atlassian-Token: no-check
  const url = `${base()}/rest/api/3/issue/${key}/attachments`;
  const form = new FormData();
  for (const f of files) {
    // f: { filename, mimeType, buffer }
    const file = new File([f.buffer], f.filename, { type: f.mimeType || 'application/octet-stream' });
    form.append('file', file, f.filename);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader(),
      'X-Atlassian-Token': 'no-check',
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} -> ${res.status}: ${text}`);
  }
  return await res.json();
}


