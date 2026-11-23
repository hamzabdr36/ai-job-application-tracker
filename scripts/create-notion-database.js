#!/usr/bin/env node
// Creates the "Job Applications" Notion database with every property the
// workflow expects, inside a page you choose. Requires Node 18+ (built-in fetch).
//
// Usage:
//   NOTION_TOKEN=your_integration_secret NOTION_PARENT_PAGE_ID=your_page_id \
//     node scripts/create-notion-database.js
//
// Before running: open the parent page in Notion → ••• → Connections → add your integration.
// The token is read from the environment only. It is never written to disk.

const token = process.env.NOTION_TOKEN;
const parent = (process.env.NOTION_PARENT_PAGE_ID || '').replace(/-/g, '').slice(-32);

if (!token || parent.length !== 32) {
  console.error('Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID (32-character ID from the page URL).');
  process.exit(1);
}

const select = (names) => ({ select: { options: names.map(([name, color]) => ({ name, color })) } });

const body = {
  parent: { type: 'page_id', page_id: parent },
  title: [{ type: 'text', text: { content: 'Job Applications' } }],
  properties: {
    'Company': { title: {} },
    'Role': { rich_text: {} },
    'Status': select([
      ['Applied', 'blue'], ['Under Review', 'gray'], ['Assessment', 'orange'], ['Interview', 'green'],
      ['Offer', 'yellow'], ['Rejected', 'red'], ['No Response', 'brown'],
    ]),
    'Applied Date': { date: {} },
    'Company Domain': { rich_text: {} },
    'Source': select([
      ['LinkedIn', 'blue'], ['Indeed', 'purple'], ['Company Site', 'green'], ['Referral', 'pink'], ['Other', 'gray'],
    ]),
    'Thread IDs': { rich_text: {} },
    'Last Reply Date': { date: {} },
    'Last Reply Summary': { rich_text: {} },
    'Next Action': { rich_text: {} },
    'Needs Review': { checkbox: {} },
    'Job URL': { url: {} },
  },
};

(async () => {
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Notion API error ${res.status}: ${data.message || JSON.stringify(data)}`);
    if (res.status === 404) console.error('Is the parent page connected to your integration? (••• → Connections)');
    process.exit(1);
  }
  console.log('Created "Job Applications" database.');
  console.log(`Database ID (paste into the Config node): ${data.id.replace(/-/g, '')}`);
  console.log(`Open it: ${data.url}`);
})();
