export async function notifyIfConfigured({ title, text, url }) {
  const slack = process.env.SLACK_WEBHOOK_URL;
  const teams = process.env.TEAMS_WEBHOOK_URL;

  const lines = [];
  lines.push(`*${title}*`);
  if (text) lines.push(text);
  if (url) lines.push(url);
  const message = lines.join('\n');

  const results = [];
  if (slack) results.push(postSlack(slack, message));
  if (teams) results.push(postTeams(teams, title, message));
  await Promise.allSettled(results);
}

async function postSlack(webhookUrl, text) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function postTeams(webhookUrl, title, text) {
  // Basic MessageCard format works for many Teams incoming webhooks.
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: title,
      title,
      text,
    }),
  });
}


