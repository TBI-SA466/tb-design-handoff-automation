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
  url.searchParams.set('fields', 'summary,description,status');
  return httpJson(url.toString(), { headers: authHeader() });
}

export async function jiraSearchJql(jql, { maxResults = 25 } = {}) {
  const url = new URL(`${base()}/rest/api/3/search`);
  url.searchParams.set('jql', jql);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('fields', 'summary,description,status');
  return httpJson(url.toString(), { headers: authHeader() });
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


