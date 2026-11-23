#!/usr/bin/env node
// Zero-dependency tests for the workflow's Code nodes.
// Each test loads the node's JavaScript straight from workflows/*.json and runs it
// with small mocks of n8n's globals ($input, $json, $('Node')), so the tests
// always check exactly the code that runs in n8n.
//
//   node tests/run-tests.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
const tracker = load('job-tracker.json');
const digest = load('weekly-digest.json');

function codeNode(wf, name) {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Code node "${name}" not found`);
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$json', '$', `return (async () => {\n${node.parameters.jsCode}\n})();`);
  return async ({ input = [], json = {}, nodes = {} } = {}) => {
    const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
    const $ = (n) => {
      if (!(n in nodes)) throw new Error(`Test did not mock node "${n}"`);
      return { first: () => ({ json: nodes[n] }) };
    };
    return (await fn($input, json, $)).map((item) => item.json);
  };
}

const prefilter = codeNode(tracker, 'Pre-filter job emails');
const prepare = codeNode(tracker, 'Prepare LLM Input');
const decide = codeNode(tracker, 'Decide');
const discord = codeNode(tracker, 'Build Discord message');
const findStale = codeNode(digest, 'Find stale applications');
const summary = codeNode(digest, 'Build weekly summary');

// ---------------------------------------------------------------- fixtures
const gmail = (id, from, subject, text, extra = {}) => ({
  id, threadId: extra.threadId || `t-${id}`, from: { value: [{ address: from, name: extra.name || '' }] },
  subject, text, date: extra.date || '2026-11-20T10:00:00Z',
});
const notionPage = (id, company, extra = {}) => ({
  id, url: `https://www.notion.so/${id}`,
  properties: {
    'Company': { title: [{ plain_text: company }] },
    'Role': { rich_text: extra.role ? [{ plain_text: extra.role }] : [] },
    'Company Domain': { rich_text: extra.domain ? [{ plain_text: extra.domain }] : [] },
    'Thread IDs': { rich_text: extra.threads ? [{ plain_text: extra.threads }] : [] },
    'Status': { select: { name: extra.status || 'Applied' } },
    'Applied Date': { date: extra.applied ? { start: extra.applied } : null },
    'Last Reply Date': { date: extra.lastReply ? { start: extra.lastReply } : null },
    'Needs Review': { checkbox: !!extra.needsReview },
    'Next Action': { rich_text: [] },
  },
});
const emailItem = (o = {}) => ({
  messageId: 'm1', threadId: 't1', fromAddress: 'jobs@acme.com', fromName: 'Acme', fromDomain: 'acme.com',
  viaAts: false, viaBoard: false, subject: 'Your application', date: '2026-11-21T09:00:00.000Z', body: '...', ...o,
});
const candidate = (o = {}) => ({
  id: 'p1', url: 'https://www.notion.so/p1', company: 'Acme', role: 'Backend Engineer', domain: 'acme.com',
  threadIds: ['t0'], status: 'Applied', ...o,
});
const llm = (o) => ({ text: JSON.stringify({
  email_type: 'other', company: '', role: '', matched_application: null, summary: '', next_action: '', deadline: '', ...o,
}) });
const runDecide = (llmOut, { email = emailItem(), cands = [candidate()], detIndex = -1, detReason = '' } = {}) =>
  decide({
    json: llmOut,
    nodes: {
      'Loop Over Emails': email,
      'Prepare LLM Input': { candidates: cands, detIndex, detReason, shownCount: cands.length },
      'Config': { notionDatabaseId: 'DB' },
    },
  }).then((r) => r[0]);

// ---------------------------------------------------------------- tests
const tests = {
  'pre-filter keeps ATS confirmation and drops job alerts and personal mail': async () => {
    const out = await prefilter({ input: [
      gmail('a', 'no-reply@us.greenhouse-mail.io', 'Thank you for applying to Acme', 'We received your application {x}.'),
      gmail('b', 'jobalerts-noreply@linkedin.com', '30 new jobs for you', 'Recommended jobs'),
      gmail('c', 'friend@example.org', 'Dinner on Saturday?', 'Are you free?'),
      gmail('d', 'sarah@acme.com', 'Interview invitation', 'We would like to invite you to an interview.'),
    ] });
    assert.deepStrictEqual(out.map((e) => e.messageId), ['a', 'd']);
    assert.strictEqual(out[0].viaAts, true);
    assert.ok(!/[{}]/.test(out[0].body), 'braces are stripped for the prompt template');
    assert.strictEqual(out[1].fromDomain, 'acme.com');
  },

  'prepare matches by Gmail thread first, then by sender domain': async () => {
    const pages = { results: [
      notionPage('p1', 'Acme', { domain: 'acme.com', threads: 't9' }),
      notionPage('p2', 'Globex', { domain: 'globex.com', threads: 't5' }),
    ] };
    const byThread = (await prepare({ input: [pages], nodes: { 'Loop Over Emails': emailItem({ threadId: 't5' }) } }))[0];
    assert.strictEqual(byThread.detIndex, 1);
    assert.strictEqual(byThread.detReason, 'thread');
    const byDomain = (await prepare({ input: [pages], nodes: { 'Loop Over Emails': emailItem({ threadId: 'new' }) } }))[0];
    assert.strictEqual(byDomain.detIndex, 0);
    assert.strictEqual(byDomain.detReason, 'domain');
    assert.ok(!/[{}]/.test(byDomain.prompt), 'prompt contains no braces');
  },

  'confirmation for an unknown job creates a row with status Applied': async () => {
    const r = await runDecide(llm({ email_type: 'application_confirmation', company: 'NewCo', role: 'SRE' }), { cands: [] });
    assert.strictEqual(r.action, 'create');
    assert.strictEqual(r.route, 0);
    assert.strictEqual(r.notionBody.properties.Status.select.name, 'Applied');
    assert.strictEqual(r.notionBody.properties['Needs Review'].checkbox, false);
    assert.ok(r.notionBody.properties['Applied Date']);
  },

  'rejection updates the matched row and notifies': async () => {
    const r = await runDecide(llm({ email_type: 'rejection', company: 'Acme', summary: 'Not moving forward.' }), { detIndex: 0, detReason: 'thread' });
    assert.strictEqual(r.action, 'update');
    assert.strictEqual(r.pageId, 'p1');
    assert.strictEqual(r.status, 'Rejected');
    assert.strictEqual(r.notify, true);
    assert.ok(r.notionBody.properties['Thread IDs'].rich_text[0].text.content.includes('t1'));
  },

  'status never goes backwards (Interview stays Interview on a status update)': async () => {
    const r = await runDecide(llm({ email_type: 'status_update', company: 'Acme' }), { cands: [candidate({ status: 'Interview' })], detIndex: 0 });
    assert.strictEqual(r.status, 'Interview');
  },

  'reply for a job that was never logged creates a row flagged Needs Review': async () => {
    const r = await runDecide(llm({ email_type: 'interview_invite', company: 'Initech' }), { cands: [] });
    assert.strictEqual(r.action, 'create');
    assert.strictEqual(r.notionBody.properties['Needs Review'].checkbox, true);
    assert.strictEqual(r.notionBody.properties.Status.select.name, 'Interview');
  },

  'company-name fallback matches "Acme Inc." to "Acme"': async () => {
    const r = await runDecide(llm({ email_type: 'assessment', company: 'Acme Inc.' }), { email: emailItem({ fromDomain: 'gmail.com', fromAddress: 'someone@mail.example' }) });
    assert.strictEqual(r.matchedBy, 'name');
    assert.strictEqual(r.status, 'Assessment');
  },

  'parses JSON from "thinking" models that write notes first': async () => {
    const text = 'We need JSON only. Maybe {draft}? Could be "No action". Let\'s formulate.\n\n' +
      JSON.stringify({ email_type: 'offer', company: 'Acme', role: '', matched_application: 1, summary: 'Offer!', next_action: 'Sign', deadline: 'Dec 5' });
    const r = await runDecide({ text }, { detIndex: -1 });
    assert.strictEqual(r.status, 'Offer');
    assert.strictEqual(r.matchedBy, 'llm');
  },

  'unreadable LLM output is retried, not labelled': async () => {
    const r = await runDecide({ text: 'Sorry, I cannot help with that.' });
    assert.strictEqual(r.route, 4);
    assert.strictEqual(r.action, 'retry');
  },

  'recruiter outreach only notifies; non-job mail is skipped': async () => {
    assert.strictEqual((await runDecide(llm({ email_type: 'recruiter_outreach' }))).route, 2);
    assert.strictEqual((await runDecide(llm({ email_type: 'other' }))).route, 3);
  },

  'Discord message: short line for confirmations, embed for replies': async () => {
    const base = { company: 'Acme', role: 'SWE', status: 'Rejected', summary: 'No.', nextAction: '', deadline: '', threadId: 't1', pageUrl: '', fromAddress: 'a@acme.com', subject: 's' };
    const conf = (await discord({ json: {}, nodes: { Decide: { ...base, type: 'application_confirmation' } } }))[0];
    assert.ok(conf.discordBody.content.includes('Logged new application'));
    const rej = (await discord({ json: { url: 'https://www.notion.so/p1' }, nodes: { Decide: { ...base, type: 'rejection' } } }))[0];
    assert.ok(rej.discordBody.embeds[0].title.includes('Rejection'));
    assert.ok(rej.discordBody.embeds[0].fields.every((f) => f.value), 'no empty embed fields');
  },

  'weekly digest flags Applied jobs with no reply after N days': async () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const input = [{ results: [
      notionPage('old', 'Ghost Inc', { applied: old }),
      notionPage('new', 'Fresh Co', { applied: recent }),
      notionPage('replied', 'Talky', { applied: old, lastReply: recent }),
      notionPage('int', 'Acme', { applied: old, status: 'Interview' }),
    ] }];
    const stale = await findStale({ input, nodes: { Config: { noResponseAfterDays: 21 } } });
    assert.deepStrictEqual(stale.map((s) => s.pageId), ['old']);
    const sum = (await summary({ input, nodes: { Config: { noResponseAfterDays: 21 } } }))[0];
    const pipeline = sum.discordBody.embeds[0].fields.find((f) => f.name === 'Pipeline').value;
    assert.ok(pipeline.includes('No Response: **1**') && pipeline.includes('Interview: **1**'));
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}\n      ${e.message}`);
    }
  }
  console.log(`\n${Object.keys(tests).length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
