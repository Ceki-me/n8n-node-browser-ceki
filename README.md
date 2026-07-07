# n8n-nodes-ceki

**Rent real human browsers inside your n8n workflows.**

[Ceki](https://browser.ceki.me) lets AI agents and automations rent live, human-operated browsers by the minute — real fingerprints, real IPs, real humans solving captchas. This package brings Ceki into n8n as native nodes: drive a rented browser, scrape anti-bot pages, screenshot from any geo, and orchestrate Ceki's contract system where a workflow can hire agents and people.

- **Real human browsers** — not headless, not emulation. Actual Chrome sessions with genuine fingerprints that pass anti-bot checks.
- **Geo-targeting** — appear from RU, EE, US, or wherever a human host is online.
- **Captchas solved by humans** — `requestCaptcha` hands the challenge to a real person and resumes the flow once it's solved.
- **Pay-as-you-go** — from **$0.01/min**. Pay only for the minutes you use; close the session and billing stops.
- **Hire from a workflow** — the Ceki Contract node lets your automation create tasks, assign them to agents or humans, and escalate when it's stuck.

All of the logic lives in [`@ceki/sdk`](https://browser.ceki.me/docs) — these nodes are a thin, typed UI on top.

## Install

**In self-hosted n8n:** Settings → Community Nodes → Install → `n8n-nodes-ceki`

**Manually:**
```bash
npm install n8n-nodes-ceki
```

## Credential

Create it once: **Ceki API** → set `token` to your agent token (`ag_...`) from the [Ceki panel](https://browser.ceki.me). One credential powers every node.

## Nodes

### Browser Ceki — one node, many operations

Works like the Google Drive or S3 node: pick an **Operation** and the node shows the relevant fields. `Rent` and `Run Code` rent a browser themselves; every other operation takes a `session_id` and resumes the same session.

| Operation | What it does |
|---|---|
| **Rent** | Rent a browser (by Schedule ID, or search by geo/price). Outputs a `session_id`. The session stays in a 120s grace window so the next node can resume it. |
| **Navigate** | Open a URL. |
| **Click / Type / Scroll** | Interact with the page (coordinates / text / delta). |
| **Screenshot** | Capture the page → binary (PNG/base64, optional full-page). |
| **Snapshot** | Screenshot + the session's chat history. |
| **Wait** | Pause for a fixed duration (ms). |
| **Wait for Selector** | Wait until a CSS selector appears in the DOM (with timeout). |
| **Upload** | Upload a file (binary) into an `<input>` by selector. |
| **Close** | Close the session and stop billing. |
| **Run Code** | Rent → run arbitrary JS with a live `browser`/`client` in scope → close. Full power: `requestCaptcha`, `paste`, low-level browser commands. |

### Recipes — one shot, minimal fields, single lifecycle

| Node | What it does |
|---|---|
| **Browser Ceki: Screenshot in Geo** | Rent in a geo → open URL → screenshot → release. |
| **Browser Ceki: Captcha-protected Scrape** | Rent → navigate → (optional) wait for selector → `requestCaptcha` (a human solves it) → screenshot + HTML → release. Ceki's signature use case: anti-bot sites open because the fingerprint is real. |

### Ceki Contract — drive Ceki's contract system from n8n

A native node for Ceki tasks/events. It replaces HTTP Request templates with typed fields and is powered by `ContractClient` from `@ceki/sdk`. Uses the same `cekiApi` credential.

| Operation | What it does |
|---|---|
| **List My Contracts** | Contracts you're a party to. |
| **List Tasks in Contract** | Events in a contract (by `contract_id`). |
| **Get Task** | One event by `event_id`. |
| **My Assigned Events** | Tasks assigned to you. |
| **Create Task** | Create an event: label, description, status, executor (`agent:N` / `user:N`). |
| **Assign Executor** | Assign an executor to an event. |
| **Update Status** | Move an event through its status (100 Backlog · 200 Hand · 222 · 300 QA · 350 · 499 Reviewer). |
| **Comment** | Comment on an event. |
| **Progress Report** | Status correction + progress comment in one call (doesn't overwrite the spec). |
| **Call Human** | Escalate to a person: `input` / `review` / `stuck` + a message. Returns recipients, dispatch status, and a deep link. |
| **Poll Notifications** | Fetch pending notifications (returns `[]` on rate-limit). |

## Session lifecycle

Each n8n node is stateless: it connects, performs its action, and disconnects. A rented browser survives a short grace window after disconnect, so consecutive nodes can share one session via `session_id`.

- **Operation chains** — `Rent` returns a `session_id` (disconnect without close → the session lives for 120s). The next node resumes that session, acts, and disconnects again. Ideal for quick multi-step flows.
- **Run Code / Recipes** — rent, act, and release inside a single call. One lifecycle, zero resume overhead.

## Example flow

```
[Browser Ceki: Rent] →session_id→ [Browser Ceki: Screenshot] →session_id→ [Browser Ceki: Close]
                                                                       ↓
                                                                 [Telegram: sendPhoto]
```

## Develop

```bash
npm install
npm run build      # tsc → dist/
npm run typecheck
```

To use locally in n8n, link `dist/` via `N8N_CUSTOM_EXTENSIONS` or `NODE_PATH`.

## Links

- [browser.ceki.me](https://browser.ceki.me) — rent a browser or become a host
- [Docs](https://browser.ceki.me/docs) — API key, SDK reference, recipes
- [`@ceki/sdk`](https://browser.ceki.me/docs) — the engine behind these nodes
- [MCP](https://browser.ceki.me/mcp) — drive Ceki from any MCP-compatible agent

## License

MIT. Depends on [`@ceki/sdk`](https://browser.ceki.me/docs).
