# Setup Guide

This guide takes you from zero to a running tracker. It takes about 45 minutes the first time; most of that is the Google OAuth setup.

**You'll need:**
- A **self-hosted n8n** (version 1.x, with the AI / LangChain nodes). It must be reachable at `http://localhost:5678` or an **https** URL, because Google OAuth refuses plain-http IP addresses.
- A **local LLM**: [Ollama](https://ollama.com) or any OpenAI-compatible server (LM Studio, vLLM, llama.cpp, LocalAI). Use a 7B+ instruct model, e.g. `qwen2.5:7b` or `llama3.1:8b`.
- The **Gmail** account you apply to jobs from, a **Notion** workspace, and a **Discord** server.
- **Node.js 18+**, only if you want to use the helper script or run the tests.

Everything below is free: there's no paid API, and no billing account is needed in Google Cloud.

---

## 1. Notion

### 1a. Create an integration
1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
2. Type **Internal**, name it e.g. `n8n Job Tracker`, select your workspace → **Save**.
3. Under **Capabilities**, make sure *Read*, *Update* and *Insert content* are ticked.
4. Copy the **Internal Integration Secret**. You'll paste it into n8n in step 5.

### 1b. Create a page and connect the integration
1. In Notion, create a page, e.g. **Job Search**.
2. On that page: **•••** (top right) → **Connections** → **+ Add connections** → pick your integration → **Confirm**.
   > Integrations can't see anything until you invite them to a page. If you skip this, n8n gets `404 object_not_found`.
3. Copy the page ID: the 32-character code at the end of the page URL.

### 1c. Create the database
**Option A, with the script (recommended):**
```bash
NOTION_TOKEN=your_integration_secret \
NOTION_PARENT_PAGE_ID=your_page_id \
node scripts/create-notion-database.js
```
It prints the **database ID**. Keep it for step 5.

**Option B, by hand:** inside the page, add a full-page database called **Job Applications** with these properties. Names must match exactly:

| Property | Type | Options / notes |
|---|---|---|
| Company | Title | |
| Role | Text | |
| Status | Select | `Applied`, `Under Review`, `Assessment`, `Interview`, `Offer`, `Rejected`, `No Response` |
| Applied Date | Date | |
| Company Domain | Text | e.g. `acme.com`, which improves reply matching |
| Source | Select | `LinkedIn`, `Indeed`, `Company Site`, `Referral`, `Other` |
| Thread IDs | Text | filled by the workflow; don't edit |
| Last Reply Date | Date | |
| Last Reply Summary | Text | |
| Next Action | Text | |
| Needs Review | Checkbox | ticked when a reply arrives for a job that was never logged |
| Job URL | URL | optional |

The database ID is the 32-character code in the database's URL, before `?v=`.

**Tip:** add a **Board** view grouped by **Status** for a kanban pipeline.

---

## 2. Gmail (Google OAuth)

### 2a. Find your n8n redirect URL
In n8n: **Credentials → Create credential → Gmail OAuth2 API**. Copy the **OAuth Redirect URL** it shows, e.g. `https://n8n.your-domain.com/rest/oauth2-credential/callback`, and keep the dialog open.

### 2b. Google Cloud project
1. <https://console.cloud.google.com> → project picker → **New project** → e.g. `n8n-job-tracker` → **Create**, then select it.
2. **APIs & Services → Library** → **Gmail API** → **Enable**.

### 2c. OAuth consent screen
**APIs & Services → OAuth consent screen** → **Get started**:
- App name: anything, e.g. `n8n Job Tracker`. Support email: your email.
- Audience: **External**. Contact email: your email → **Create**.

Then choose **Testing** or **Production**:

| | Testing (quick) | Production (no weekly re-login) |
|---|---|---|
| Who can sign in | only emails listed under **Audience → Test users** | anyone (in practice only you, since nobody else has your n8n) |
| Login lifetime | **expires every 7 days** (n8n credential → Reconnect) | permanent |
| Extra requirements | add your Gmail as a test user | home page + privacy policy URL + authorized domain |

**For Production:**
1. Host the two pages from [`docs/oauth-pages/`](oauth-pages/) for free on GitHub Pages: create a repo named `YOUR-USERNAME.github.io`, upload `index.html` and `privacy.html`, and wait 1–2 minutes.
2. **Branding:** home page `https://YOUR-USERNAME.github.io`, privacy policy `https://YOUR-USERNAME.github.io/privacy.html`.
   Under **Authorized domains**, add `YOUR-USERNAME.github.io` **and** your n8n domain (e.g. `your-domain.com`, unless you use localhost). Don't upload a logo, because that triggers a review.
3. **Audience → Publish app → Confirm**. Ignore the "verification" notice: an unverified app works for up to 100 users and only shows a warning at sign-in. **Don't submit for verification**, because restricted Gmail scopes can require a paid security assessment.

### 2d. OAuth client
**Clients → + Create client** → **Web application** → under **Authorized redirect URIs**, paste the n8n redirect URL from 2a → **Create**. Copy the **Client ID** and **Client Secret**.

### 2e. Connect n8n
1. Paste the Client ID and Secret into the n8n Gmail credential → **Sign in with Google** → choose your jobs Gmail.
2. On "Google hasn't verified this app", click **Advanced → Go to … (unsafe)**. It's your own app.
3. **Tick every permission checkbox** → **Continue**. n8n shows **Account connected** → **Save**.

### 2f. Create the label
In Gmail: **Settings → Labels → Create new label** → `jt-processed`.

---

## 3. Discord
1. Create a server if you need one (**+** → *Create My Own*), then a text channel, e.g. `#job-tracker`.
2. Channel ⚙️ **Edit Channel → Integrations → Webhooks → New Webhook** → **Copy Webhook URL** → **Save Changes**.
3. Optional test:
   ```bash
   curl -H "Content-Type: application/json" -d '{"content":"✅ test"}' "YOUR_DISCORD_WEBHOOK_URL"
   ```

> Treat the webhook URL like a password: anyone who has it can post in your channel.

---

## 4. Local LLM

**Ollama:** in n8n, the **Local LLM (Ollama)** node → **Credential → Create new** → **Base URL**:
- n8n and Ollama on the same machine: `http://localhost:11434`
- n8n in Docker, Ollama on the host: `http://host.docker.internal:11434`
- Docker Compose service: `http://ollama:11434`
- Another machine: `http://<ip>:11434` (start Ollama with `OLLAMA_HOST=0.0.0.0`)

Then pick a model. Under Options, set **Temperature** to `0` and, if offered, **Format** to `JSON`.

**OpenAI-compatible server (LM Studio, vLLM, llama.cpp…):** delete the Ollama node, click **+** under **Model** on **Classify email (LLM)** → **OpenAI Chat Model** → credential with any API key (or the real one) and **Base URL** `http://<host>:<port>/v1` → choose the model → Temperature `0`.

"Thinking" models (ones that reason before answering) work too, because the Decide node pulls the JSON out of their answer.

---

## 5. Import and configure the workflow
1. n8n → **Workflows → Import from File** → `workflows/job-tracker.json`.
2. **Config** node: paste your **Notion database ID** and **Discord webhook URL**, replacing the `YOUR_…` placeholders.
3. Select credentials:
   - **Get recent emails** and **Mark email processed** → Gmail
   - **Get open applications (Notion)**, **Create Notion row**, **Update Notion row** → create a **Notion API** credential with your integration secret
   - **Local LLM (Ollama)** → your LLM credential and model
4. **Mark email processed** → **Label Names or IDs** → `jt-processed`.
5. **Save.**

---

## 6. Test

Send these **from a different email address** to your jobs Gmail. The workflow skips mail you sent yourself. Send one at a time, then click **Execute workflow** after each.

**Test 1: confirmation.** Subject `Thank you for applying to TestCo – Backend Engineer`
```
Thank you for applying for the Backend Engineer position at TestCo.
We have received your application and our hiring team will review it shortly.
```
➡️ A new Notion row (TestCo, **Applied**) and a 📝 Discord message.

**Test 2: rejection.** **Reply in the same thread:**
```
Thank you for your interest in the Backend Engineer role at TestCo.
After careful review, we have decided to move forward with other candidates.
```
➡️ The same row changes to **Rejected**, with a ❌ Discord message.

**Test 3: not a job email.** Subject `Dinner on Saturday?`, body `Are you free at 8?`
➡️ Nothing happens; the pre-filter drops it.

Afterwards, delete the test rows in Notion.

### Go live
Activate the workflow: the **Active** toggle, or **Publish** in newer n8n versions. It now runs every 15 minutes. To change the interval, edit the **Every 15 minutes** node and re-publish.

### Optional: backfill past applications
In **Get recent emails**, change `newer_than:2d` to `newer_than:60d` and the limit to `500`, run it once, then change it back.

---

## 7. Weekly digest (optional)
Import `workflows/weekly-digest.json`, fill in its **Config** node (same database ID and webhook; `noResponseAfterDays` defaults to 21), select the Notion credential on its two Notion nodes, and activate it. Every Monday at 9:00 it posts a pipeline summary and marks stale applications **No Response**.

---

## Customizing
| What | Where |
|---|---|
| Check interval | **Every 15 minutes** node |
| Which emails are considered | `ATS_DOMAINS`, `BOARD_DOMAINS`, `KEYWORDS`, `NOISE` in **Pre-filter job emails** |
| Gmail search | **Filters → Search** in **Get recent emails** |
| Status rules | `TYPE_STATUS` and `RANK` in **Decide** |
| Discord colours and emoji | `STYLE` in **Build Discord message** |

## Troubleshooting
| Problem | Fix |
|---|---|
| Notion `404 object_not_found` / "make sure the page is shared with your integration" | Connect the integration to the page (step 1b). It must be added on the page itself, not just installed in the workspace. |
| Notion `400 … is not a property that exists` | A property name or type differs from the table in step 1c. |
| `redirect_uri_mismatch` | The URI in the Google client must exactly match n8n's redirect URL. |
| "Invalid redirect: must be added to authorized domains" | Add your n8n domain under **Branding → Authorized domains**. |
| Gmail stops working after a week | The app is in Testing. Publish it (step 2c) and reconnect the credential. |
| Workflow runs but nothing happens | Open the execution. If **Pre-filter job emails** output nothing, the emails didn't look job-related (or came from your own address). |
| **Route** goes to output 4 every time | The LLM's answer couldn't be parsed. Check **Classify email (LLM)**'s output for errors, use a bigger model, or set Format → JSON. |
| No Discord message | Check the webhook URL in **Config** and run the curl test from step 3. |
