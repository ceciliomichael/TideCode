# OpenClaw Learning Guide: From Zero to Job-Ready Understanding

_Last updated: May 6, 2026_

This guide explains OpenClaw in plain English, then connects it to the **AI Systems Engineer / Head of AI** job post from OnlineJobs.ph. The goal is not to memorize every command. The goal is to understand what OpenClaw is, how it works, how it is usually set up, and how you can talk about it intelligently when applying for a role that mentions legacy OpenClaw systems.

Sources used:

- OpenClaw official overview: https://docs.openclaw.ai/index
- OpenClaw getting started: https://docs.openclaw.ai/start/getting-started
- OpenClaw agents CLI: https://docs.openclaw.ai/cli/agents
- OpenClaw skills docs: https://docs.openclaw.ai/tools/skills
- OpenClaw gateway configuration: https://docs.openclaw.ai/gateway/configuration
- OpenClaw agent workspace docs: https://docs.openclaw.ai/concepts/agent-workspace
- Job post: https://www.onlinejobs.ph/jobseekers/job/AI-Systems-Engineer-Head-of-AI-1634935

---

## 1. The shortest explanation

OpenClaw is a **self-hosted gateway for AI agents**.

That means it lets you run an AI assistant from your own machine or server and connect it to communication channels such as Telegram, Slack, WhatsApp, Discord, Signal, Microsoft Teams, Google Chat, WebChat, and other surfaces.

Instead of only using an AI model in a browser tab, OpenClaw gives you a system where:

1. A user sends a message from a channel.
2. OpenClaw receives the message through its Gateway.
3. The Gateway routes the message to an agent session.
4. The agent uses a model, workspace context, memory, tools, and skills.
5. The answer is sent back to the original channel.

In very simple terms:

```text
Chat app / dashboard / channel
        ↓
OpenClaw Gateway
        ↓
Agent session
        ↓
Model + tools + skills + workspace
        ↓
Response back to user
```

So OpenClaw is not just “an AI chatbot.” It is a **routing and orchestration layer** around AI agents.

---

## 2. What problem OpenClaw solves

Normally, an AI workflow can become messy very quickly.

A company may have:

- one bot in Telegram,
- one Slack automation,
- one Python script calling OpenAI,
- one Claude workflow,
- one dashboard on Firebase,
- one Google Apps Script automation,
- one customer support classifier,
- one reporting agent,
- one finance summarizer,
- and several people maintaining their own separate systems.

The core problem is that these systems often do not talk to each other. There may be no clear owner, no shared routing system, no consistent model selection, no shared memory, no security standard, and no clean way to see which agent is responsible for which task.

OpenClaw tries to solve part of that by giving you one central Gateway where messages, sessions, channels, agents, and tools can be coordinated.

The official docs describe OpenClaw as a gateway for AI agents across many communication channels, with a single Gateway process acting as the bridge between channels and agents.

---

## 3. Core mental model

The easiest way to understand OpenClaw is to separate it into six pieces.

### 3.1 Gateway

The **Gateway** is the control center.

It handles things like:

- inbound messages,
- outbound messages,
- channel connections,
- routing,
- sessions,
- access policies,
- model/provider configuration,
- dashboard/control UI access,
- config loading,
- restart/reload behavior.

If OpenClaw were a company, the Gateway would be the operations manager. It does not do all the work itself. It decides where things go and keeps the system connected.

### 3.2 Channels

A **channel** is a place where someone can talk to the agent.

Examples:

- Telegram bot,
- Slack workspace,
- WhatsApp,
- Discord,
- Signal,
- Microsoft Teams,
- Google Chat,
- WebChat,
- dashboard chat.

A channel is not the agent itself. It is just the entry point.

For example:

```text
User sends Telegram message
        ↓
Telegram channel receives it
        ↓
Gateway decides which agent/session should handle it
```

### 3.3 Agents

An **agent** is an AI worker with its own identity, workspace, routing, and sometimes its own model and skills.

You can think of agents like specialized team members:

- Support Agent
- Ops Agent
- Finance Agent
- Marketing Agent
- CEO Briefing Agent
- Reporting Agent

The official agents docs describe the `openclaw agents` commands as a way to manage isolated agents, including workspaces, auth, and routing.

A key command pattern is:

```bash
openclaw agents list
openclaw agents add ops --workspace ~/.openclaw/workspace-ops --bind telegram:ops --non-interactive
openclaw agents bind --agent ops --bind telegram:ops
openclaw agents bindings
```

The important concept is not the exact command. The important concept is this:

> Different incoming channels or accounts can be pinned to different agents.

That means you can route Telegram ops messages to an Ops Agent, Slack support messages to a Support Agent, and private dashboard questions to a CEO/Analytics Agent.

### 3.4 Workspace

A **workspace** is the agent’s home folder.

The official docs say the workspace is the working directory used for file tools and workspace context. It is separate from the main `~/.openclaw/` configuration and credentials area.

Common workspace files include:

- `AGENTS.md` — operating instructions and behavior rules
- `SOUL.md` — persona, tone, boundaries
- `USER.md` — information about the user
- `IDENTITY.md` — agent name and identity details
- `TOOLS.md` — notes about local tools and conventions
- `HEARTBEAT.md` — optional small checklist for recurring heartbeat runs
- `BOOT.md` — optional startup checklist
- `BOOTSTRAP.md` — one-time first-run ritual
- `memory/YYYY-MM-DD.md` — daily memory logs
- `MEMORY.md` — optional long-term memory
- `skills/` — workspace-specific skills

Plain-English version:

> The workspace is where the agent keeps its instructions, context, notes, and task-specific files.

Important safety note: a workspace is not automatically a perfect security sandbox. The docs warn that absolute paths may still reach outside the workspace unless sandboxing is enabled. So in production, you should configure sandboxing and permissions carefully.

### 3.5 Skills

**Skills** teach an agent how to use tools or perform specialized workflows.

According to the official docs, OpenClaw skills are folders containing a `SKILL.md` file with YAML frontmatter and instructions. Skills can be bundled, local, shared, per-agent, or workspace-specific.

Think of a skill as a written SOP for the agent:

- when to use a tool,
- how to call it,
- what rules to follow,
- what safety constraints matter,
- how to format the result.

Examples of possible skills:

- search the web,
- summarize support tickets,
- generate a report,
- check a dashboard,
- draft a customer reply,
- update a spreadsheet,
- use a browser,
- call an internal API.

Skill visibility matters. The docs explain that skill location and skill visibility are separate. You can have shared skills, but also use allowlists so only certain agents can use certain skills.

Example concept:

```json5
{
  agents: {
    defaults: {
      skills: ["web-search", "docs-search"]
    },
    list: [
      { id: "support", skills: ["support-ticket-summary", "support-reply-draft"] },
      { id: "finance", skills: ["finance-report-readonly"] },
      { id: "locked-down", skills: [] }
    ]
  }
}
```

This matters because not every agent should have every power.

For example:

- A support agent may need ticket-reading access but not payroll access.
- A finance agent may need accounting summaries but not customer messaging permissions.
- A public-facing bot should not have shell execution or unrestricted file access.

### 3.6 Model providers

OpenClaw needs access to at least one model provider.

Examples:

- Anthropic Claude,
- OpenAI,
- Google Gemini,
- local models,
- other compatible providers depending on setup.

The model is the reasoning engine. OpenClaw is the orchestration and routing layer around it.

A useful mental distinction:

```text
Claude/OpenAI/Gemini = brain
OpenClaw Gateway = router/control plane
Agent = role + context + behavior
Skills/tools = hands
Workspace/memory = notes and working area
Channels = where humans interact
```

---

## 4. How OpenClaw works step by step

Imagine a company uses Telegram for internal bot commands and Slack for team workflows.

A team member sends this message:

```text
@openclaw summarize yesterday's support tickets and tell me what themes increased.
```

Here is what likely happens conceptually.

### Step 1: Channel receives the message

The message enters through Slack or Telegram.

### Step 2: Gateway receives and normalizes it

The Gateway sees:

- which channel it came from,
- who sent it,
- which group or account it came through,
- whether the sender is allowed,
- whether the bot was mentioned,
- which routing rule applies.

### Step 3: Gateway routes to the right agent

Maybe the message came from a support Slack channel, so it goes to the Support Agent.

If it came from an executive dashboard or CEO channel, it might route to the Reporting Agent.

### Step 4: Agent loads context

The agent may load:

- its `AGENTS.md`,
- its `SOUL.md`,
- relevant memory,
- tool instructions,
- allowed skills,
- session history.

### Step 5: Agent chooses tools or skills

The agent may need to:

- query the support platform,
- read ticket data,
- summarize categories,
- compare current volume to prior days,
- draft a concise report.

### Step 6: Agent calls the model

The agent sends the composed prompt/context to the selected model.

Depending on the task, that model might be:

- a cheaper fast model for simple classification,
- a stronger reasoning model for cross-system analysis,
- a multimodal model for images/documents,
- a legacy OpenAI model for older workflows.

### Step 7: Response returns through the channel

The answer goes back to Slack, Telegram, the dashboard, or whichever channel started the interaction.

---

## 5. Basic setup pattern

The official getting-started docs describe the beginner setup like this:

1. Install OpenClaw.
2. Run onboarding.
3. Choose/configure a model provider.
4. Verify the Gateway is running.
5. Open the dashboard.
6. Send the first message.
7. Optionally connect a channel such as Telegram.

The docs mention Node.js as a requirement, with Node 24 recommended and Node 22.14+ supported. They also mention that Windows is supported natively and through WSL2, with WSL2 recommended for the full experience.

### 5.1 Install

Example from docs:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Windows PowerShell example:

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

Other install methods may include Docker, Nix, or npm depending on the current OpenClaw docs.

### 5.2 Run onboarding

```bash
openclaw onboard --install-daemon
```

The onboarding wizard is important because it helps configure:

- model provider,
- API key,
- Gateway settings,
- initial workspace,
- daemon/service behavior.

### 5.3 Verify Gateway

```bash
openclaw gateway status
```

The official docs mention that the Gateway should be listening on port `18789`.

### 5.4 Open dashboard

```bash
openclaw dashboard
```

The dashboard/control UI lets you chat, inspect configuration, manage sessions, and interact with the running Gateway.

### 5.5 Connect a channel

The docs say Telegram is usually one of the fastest channels to set up because it mainly needs a bot token.

Conceptual Telegram config:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "pairing",
      allowFrom: ["tg:123"]
    }
  }
}
```

This is only an example. Do not paste fake tokens into production.

### 5.6 Configure access controls

Access control is critical.

For direct messages, the official docs describe policies such as:

- `pairing` — unknown senders must be approved with a pairing flow,
- `allowlist` — only listed senders can message the bot,
- `open` — all inbound DMs are allowed, typically requiring wildcard permission,
- `disabled` — ignore DMs.

For group chats, you usually want mention gating, meaning the bot only responds when mentioned.

Example concept:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        groupChat: {
          mentionPatterns: ["@openclaw", "openclaw"]
        }
      }
    ]
  },
  channels: {
    whatsapp: {
      groups: {
        "*": { requireMention: true }
      }
    }
  }
}
```

---

## 6. Is setup the same for every task?

This is one of the most important questions.

The answer is:

> The base setup is mostly the same. The task-specific setup is different.

### Same base setup

Most OpenClaw use cases share these foundations:

- OpenClaw installed,
- Gateway running,
- model provider configured,
- workspace created,
- dashboard available,
- channels connected,
- access policies configured.

### Different task setup

Each task may need different:

- agent,
- channel routing,
- skills,
- workspace files,
- model choice,
- API credentials,
- tool permissions,
- safety rules,
- output format,
- retry/error handling,
- logging.

So if someone asks, “Do I set up OpenClaw once or separately for every task?” the practical answer is:

> Install and run the platform once, then create separate agents/config/routing/skills for different workflows.

---

## 7. Task-specific examples

These examples are designed around the OnlineJobs.ph role, which mentions customer support, reporting, marketing, finance, Slack, Telegram, dashboards, OpenAI legacy systems, Claude, Gemini, Python scripts, Cloudflare Tunnel, and Firebase.

### 7.1 Customer support automation

Goal:

- auto-tag tickets,
- draft replies,
- detect at-risk customers,
- reduce timeouts,
- improve quality using historical data.

Possible OpenClaw structure:

```text
Support Slack channel / Telegram bot
        ↓
OpenClaw Gateway
        ↓
Support Agent
        ↓
Support skills + ticket API + knowledge base
        ↓
Draft reply / tags / escalation notes
```

Recommended agent responsibilities:

- classify incoming tickets,
- detect topic and urgency,
- draft reply using company policy,
- flag return/cancel/refund risk,
- escalate edge cases to humans,
- avoid sending final customer messages without approval unless explicitly authorized.

Possible skills:

- `support-ticket-classifier`,
- `support-draft-reply`,
- `support-risk-escalation`,
- `support-knowledge-base-search`,
- `support-api-readonly`.

Possible model routing:

- cheap/fast model for classification,
- medium model for draft replies,
- stronger model for complex escalations or policy interpretation.

Safety rules:

- no refunds without human approval,
- no promises outside policy,
- no access to payroll/accounting,
- log all drafted recommendations,
- separate draft mode from send mode.

What to say in an application:

> For support automation, I would separate classification, draft generation, and escalation into distinct workflows. I would first audit the existing keyword classifier, ticket volume bottlenecks, API timeout behavior, and historical ticket data. Then I would decide whether the legacy OpenAI classifier should remain, be rebuilt on Claude/Gemini, or be replaced with a hybrid router based on cost and accuracy.

### 7.2 Reporting and analytics agent

Goal:

- pull data daily,
- summarize business performance,
- populate dashboard,
- answer business questions.

Possible architecture:

```text
Morning schedule / Slack trigger
        ↓
Reporting Agent
        ↓
Shopify + support platform + analytics + accounting APIs
        ↓
Summaries + dashboard updates
```

Recommended agent responsibilities:

- collect metrics,
- validate inputs,
- compare against prior periods,
- summarize changes,
- identify anomalies,
- update dashboard or send report.

Possible skills:

- `shopify-readonly-reporting`,
- `marketing-analytics-summary`,
- `cash-position-summary`,
- `dashboard-update`,
- `anomaly-detection`.

Production concerns:

- API timeouts,
- stale credentials,
- partial data,
- missing platform responses,
- duplicated reports,
- inconsistent timezone handling,
- retry logic,
- audit logs.

What to say in an application:

> For reporting, I would inventory every upstream data source, document refresh cadence and failure modes, then define one canonical data flow for daily metrics. The agent should produce explanations, but raw data extraction and dashboard writes should be handled by deterministic scripts where possible.

### 7.3 Slack-facing assistant

Goal:

- let team members use AI without leaving Slack,
- trigger automations,
- get briefings,
- request status updates,
- route different types of requests.

Possible architecture:

```text
Slack message
        ↓
Gateway Slack channel
        ↓
Routing rule
        ↓
Ops Agent / Support Agent / CEO Agent
        ↓
Response back to Slack
```

Important design choice:

Slack should not send every message to one mega-agent. Instead, requests should be routed by channel, command, mention pattern, or team context.

Examples:

- `#support-ai` → Support Agent
- `#ops-ai` → Ops Agent
- `#finance-ai` → Finance Agent
- CEO DM → CEO Briefing Agent

Safety rules:

- require mentions in group chats,
- restrict who can trigger sensitive tools,
- log admin actions,
- use read-only mode for finance by default,
- require approval for destructive actions.

What to say in an application:

> I would stabilize Slack by treating it as an interface layer, not the business logic layer. The Gateway should receive Slack events, route them to specific agents, and keep each agent’s permissions scoped to its department.

### 7.4 Finance and cash position workflows

Goal:

- summarize cash position,
- parse payments,
- generate finance reports,
- keep access restricted.

Possible architecture:

```text
Private finance Slack/Telegram channel
        ↓
Finance Agent
        ↓
Accounting APIs + cash tracker + payment logs
        ↓
Read-only report / exception list / summary
```

Recommended rules:

- default read-only access,
- never expose payroll details in broad channels,
- never send raw credentials to model context,
- summarize sensitive data carefully,
- require human review for financial actions,
- separate data extraction from LLM explanation.

Useful model approach:

- deterministic Python for pulling numbers,
- LLM for summarization and explanation,
- strong reasoning model for cross-platform analysis,
- cheap model for simple categorization.

### 7.5 Marketing/operations dashboard

Goal:

- combine customer insights,
- marketing metrics,
- accountability tracking,
- dashboards.

OpenClaw may not be the dashboard itself. The dashboard might be Firebase or another UI. OpenClaw can act as the agent layer behind it.

Possible structure:

```text
Dashboard or scheduled job
        ↓
Agent/API layer
        ↓
Marketing data + customer data + support data
        ↓
Summary and recommendations
        ↓
Firebase dashboard update
```

Important distinction:

- Firebase = dashboard hosting/presentation.
- Python/API scripts = data extraction/transformation.
- OpenClaw = agent/channel/session/routing layer.
- Claude/OpenAI/Gemini = reasoning/model layer.

---

## 8. How OpenClaw maps to the job post

The job post is not asking for a beginner who wants to “try AI.” It says they already have live production AI agents across support, operations, marketing, and finance. The core problem is that no single person owns the whole architecture.

The role wants someone who can:

- audit existing AI systems,
- unify disconnected workflows,
- fix customer support automation,
- stabilize Slack integration,
- govern API/model usage,
- train the team,
- migrate legacy OpenClaw/OpenAI systems intelligently.

OpenClaw appears in the post as a **legacy OpenAI-based system** built by a previous technical partner. That matters.

It means you should not assume their OpenClaw setup exactly matches the latest public docs. Their system may be:

- older,
- customized,
- partially broken,
- OpenAI-specific,
- tied to old support/ops workflows,
- mixed with Python scripts,
- used only for legacy automations.

So the right mindset is:

> I need to understand OpenClaw conceptually, then audit their actual implementation before making migration decisions.

### What they probably expect from you

They likely expect you to be able to answer:

1. What parts of the legacy OpenClaw system are still active?
2. Which workflows depend on it?
3. Which APIs does it call?
4. Which model provider does it use?
5. What data does it access?
6. What breaks if it is shut off?
7. Which parts should be migrated to Claude?
8. Which parts should stay on OpenAI for cost/history/accuracy reasons?
9. Which parts should be retired completely?
10. How do we document this and prevent the same mess from happening again?

---

## 9. How to audit an existing OpenClaw system

If you were hired or asked to review their setup, this is a practical audit path.

### 9.1 Inventory running services

Find:

- Is the Gateway running?
- How is it started?
- Is it a daemon/service?
- Which port is it listening on?
- Is it behind Cloudflare Tunnel?
- Is it local-only or exposed externally?
- Is there a dashboard/control UI?

Commands/concepts:

```bash
openclaw gateway status
openclaw dashboard
openclaw doctor
openclaw logs
```

### 9.2 Inspect config

Config is commonly stored around:

```text
~/.openclaw/openclaw.json
```

Look for:

- enabled channels,
- allowed senders,
- model/provider settings,
- agent list,
- default workspace,
- skills config,
- sandbox settings,
- plugin settings,
- reload mode,
- custom paths,
- credentials references.

Do not paste secrets into chat or docs.

### 9.3 Inspect agents

Run/list conceptually:

```bash
openclaw agents list
openclaw agents list --bindings
openclaw agents bindings
```

Questions:

- How many agents exist?
- What are their names?
- What workspaces do they use?
- Which channels route to which agents?
- Is everything going to one default agent?
- Are sensitive workflows separated?

### 9.4 Inspect workspaces

For each workspace, inspect:

- `AGENTS.md`,
- `SOUL.md`,
- `USER.md`,
- `TOOLS.md`,
- `MEMORY.md`,
- `memory/`,
- `skills/`,
- any scripts or local references.

Questions:

- Are instructions clear?
- Are there old assumptions?
- Are secrets accidentally stored?
- Is memory outdated or polluted?
- Are support/finance/ops instructions mixed together?

### 9.5 Inspect skills

Check:

- bundled skills,
- local managed skills,
- per-workspace skills,
- skill allowlists,
- plugin-provided skills.

Questions:

- What does each skill allow the agent to do?
- Are any skills too broad?
- Are there third-party/community skills?
- Are there skills with shell/file/browser/API powers?
- Are workspace skills overriding shared skills?

### 9.6 Inspect credentials and provider usage

Questions:

- Which provider keys exist?
- Are keys per-agent or shared?
- Are keys rotated?
- Are subscription accounts being used?
- Is there a cost router?
- Are credentials stored securely?

### 9.7 Map external dependencies

For the job post, important external systems include:

- Shopify,
- Richpanel,
- Triple Whale,
- ShipHero,
- Flexport,
- Xero,
- Gusto,
- Paychex,
- Klaviyo,
- Postscript,
- KnoCommerce,
- JudgeMe,
- Google Workspace,
- Asana,
- Firebase,
- Slack,
- Telegram.

For each dependency, document:

- API used,
- auth method,
- read/write permissions,
- workflow owner,
- data fields used,
- failure mode,
- retry behavior,
- cost impact,
- logging location.

### 9.8 Decide keep / migrate / retire

For every legacy OpenClaw workflow, assign one status:

| Status | Meaning |
|---|---|
| Keep | It works, is safe, and still fits the architecture. |
| Migrate | It is useful but should move to a cleaner Claude/Python/OpenClaw/Slack architecture. |
| Retire | It is duplicated, risky, unused, or too broken to maintain. |
| Rebuild | The concept is good, but the implementation should be replaced. |

---

## 10. What not to do

Do not approach OpenClaw like this:

- “I will connect every tool to one super-agent.”
- “I will give the bot full access and fix permissions later.”
- “I will migrate everything to one model because it is simpler.”
- “I will let the AI write directly to production systems without approval.”
- “I will install random skills from the internet without reviewing them.”
- “I will expose the Gateway publicly without access controls.”
- “I will put API keys in workspace files.”
- “I will treat LLM output as guaranteed correct.”

A production AI systems role is not about making a cool demo. It is about reliable systems.

---

## 11. Practical security checklist

OpenClaw can be powerful, so security matters.

Use this checklist:

### Access control

- Use allowlists where possible.
- Require pairing for unknown users.
- Require mention gating in group chats.
- Do not use open DM access unless there is a strong reason.
- Separate admin users from normal users.

### Agent separation

- Use separate agents for support, finance, ops, and admin workflows.
- Do not give every agent every skill.
- Use read-only skills by default.
- Add write/send/delete permissions only after review.

### Secrets

- Do not store API keys in workspace files.
- Do not commit anything under `~/.openclaw/`.
- Use environment variables, credential stores, or the tool’s credential system.
- Rotate keys regularly.

### Tool safety

- Be careful with shell execution.
- Be careful with browser automation.
- Be careful with filesystem access.
- Be careful with email/message sending tools.
- Log sensitive operations.
- Require human approval for destructive or customer-facing actions.

### Data safety

- Minimize what data goes into model context.
- Avoid sending unnecessary PII.
- Redact secrets and private customer data where possible.
- Keep finance/payroll data in private channels.
- Separate raw data extraction from LLM summarization.

### Reliability

- Add retries for API timeouts.
- Handle partial failures.
- Track model costs.
- Track latency.
- Keep dashboards honest about stale data.
- Preserve manual fallback paths.

---

## 12. How to explain OpenClaw in an interview

Use this simple explanation:

> OpenClaw is a self-hosted gateway and orchestration layer for AI agents. It connects channels like Telegram, Slack, WhatsApp, or a dashboard to agent sessions. Each agent can have its own workspace, memory, model configuration, routing, and skills. The base setup is shared, but each business workflow should be separated through agents, permissions, and task-specific skills.

If they ask how you would use it for their company:

> I would first audit the current Gateway, channel bindings, agents, workspaces, skills, provider keys, and legacy OpenAI workflows. Then I would map which automations are still active, which systems they touch, and which workflows should be kept, migrated, retired, or rebuilt. I would avoid a big-bang rewrite and prioritize the workflows causing production pain first, especially CS timeouts, Slack stabilization, and model cost governance.

If they ask whether you know their exact OpenClaw setup:

> I understand the public OpenClaw architecture, but I would treat your existing OpenClaw as a legacy internal implementation until I audit it. The right approach is to inspect the actual config, agents, workflows, scripts, credentials, and dependencies before deciding what should move to Claude or remain on OpenAI.

---

## 13. 1-day crash learning plan

You said you feel like you can learn this in one day. You can learn enough to explain and start auditing in one day, but not enough to be a true production expert. Use the day to build a clean mental model.

### Hour 1: Learn the vocabulary

Know these terms:

- Gateway
- Channel
- Agent
- Workspace
- Skill
- Tool
- Model provider
- Session
- Binding
- Allowlist
- Sandbox

Goal:

> Explain OpenClaw in one paragraph.

### Hour 2: Understand message flow

Memorize this:

```text
Channel → Gateway → Agent → Model/tools/skills/workspace → Response
```

Goal:

> Draw the architecture from memory.

### Hour 3: Read setup docs

Focus on:

- installing,
- onboarding,
- model key,
- Gateway status,
- dashboard,
- first message.

Goal:

> Explain the basic install and first-run process.

### Hour 4: Learn agents and routing

Focus on:

- creating agents,
- binding channels to agents,
- listing bindings,
- separating support/ops/finance.

Goal:

> Explain why multiple agents are better than one mega-agent.

### Hour 5: Learn workspace and skills

Focus on:

- `AGENTS.md`,
- `SOUL.md`,
- `TOOLS.md`,
- `MEMORY.md`,
- `skills/`,
- shared vs per-agent skills,
- skill allowlists.

Goal:

> Explain how an agent gets instructions and abilities.

### Hour 6: Map to the job post

Write down how OpenClaw relates to:

- support automation,
- Slack assistant,
- reporting dashboard,
- cost routing,
- legacy OpenAI systems,
- migration decisions.

Goal:

> Explain how you would audit their legacy OpenClaw dependencies.

### Hour 7: Prepare application language

Write:

1. a one-paragraph background summary,
2. a technical AI experience summary,
3. a 30-day plan outline,
4. a demo video outline.

Goal:

> Sound specific, not generic.

### Hour 8: Teach it back

Say out loud:

- what OpenClaw is,
- how setup works,
- how agents are separated,
- how skills work,
- how you would use it for support/ops/finance,
- how you would audit the job’s legacy system.

If you can teach it simply, you understand the basics.

---

## 14. 7-day learning plan

### Day 1: Core model

Learn:

- Gateway,
- channels,
- agents,
- workspaces,
- skills,
- model providers.

Deliverable:

- one-page diagram and explanation.

### Day 2: Installation and first run

Learn:

- install options,
- onboarding,
- Gateway status,
- dashboard,
- provider auth.

Deliverable:

- setup notes and troubleshooting checklist.

### Day 3: Agents and routing

Learn:

- `openclaw agents list`,
- `openclaw agents add`,
- `openclaw agents bind`,
- channel/account-specific routing,
- per-agent workspaces.

Deliverable:

- fake architecture for support, ops, finance, and CEO reporting agents.

### Day 4: Workspaces and memory

Learn:

- workspace file map,
- memory files,
- identity/persona files,
- what not to commit,
- private backups.

Deliverable:

- sample workspace plan for a Support Agent.

### Day 5: Skills and tools

Learn:

- skill folder structure,
- `SKILL.md`,
- shared vs workspace skills,
- allowlists,
- plugin skills,
- security risk.

Deliverable:

- sample skill plan for ticket classification and reply drafting.

### Day 6: Production operations

Learn:

- config validation,
- hot reload,
- access policies,
- logs,
- doctor/health commands,
- sandboxing,
- cost tracking,
- model routing.

Deliverable:

- operational checklist for a production OpenClaw deployment.

### Day 7: Job application package

Build:

- 30-day plan,
- demo video outline,
- background summary,
- AI experience breakdown,
- migration/audit strategy.

Deliverable:

- application-ready response.

---

## 15. OpenClaw cheat sheet

### 15.1 One-sentence definition

OpenClaw is a self-hosted Gateway that connects chat channels and control surfaces to AI agents with sessions, workspaces, tools, skills, and model providers.

### 15.2 Core architecture

```text
User/channel
  → Gateway
    → Routing/session
      → Agent
        → Workspace + memory + skills + tools
          → Model provider
            → Response
```

### 15.3 Main components

| Component | Meaning | Simple analogy |
|---|---|---|
| Gateway | Central process that routes messages and manages connections | Traffic controller |
| Channel | Where messages come from/go to | Phone line |
| Agent | AI worker with role/context/tools | Employee |
| Workspace | Agent home/context folder | Desk/notebook |
| Skill | Instructions for using a tool/workflow | SOP/manual |
| Model provider | Claude/OpenAI/Gemini/etc. | Brain |
| Session | Conversation state/context | Current conversation |
| Binding | Rule connecting a channel/account to an agent | Routing rule |

### 15.4 Basic install flow

```bash
# macOS/Linux example
curl -fsSL https://openclaw.ai/install.sh | bash

# onboard and configure
openclaw onboard --install-daemon

# check gateway
openclaw gateway status

# open dashboard
openclaw dashboard
```

### 15.5 Common commands to know

```bash
openclaw onboard
openclaw configure
openclaw gateway status
openclaw gateway restart
openclaw dashboard
openclaw doctor
openclaw logs
openclaw agents list
openclaw agents list --bindings
openclaw agents add <name> --workspace <path>
openclaw agents bind --agent <agent-id> --bind <channel[:accountId]>
openclaw agents bindings
```

### 15.6 Config location

Common config path:

```text
~/.openclaw/openclaw.json
```

Common workspace path:

```text
~/.openclaw/workspace
```

Common managed skills path:

```text
~/.openclaw/skills
```

Do not commit secrets or credentials.

### 15.7 Workspace files

| File/folder | Purpose |
|---|---|
| `AGENTS.md` | Main operating instructions |
| `SOUL.md` | Persona/tone/boundaries |
| `USER.md` | User profile/context |
| `IDENTITY.md` | Agent identity/name |
| `TOOLS.md` | Local tool notes and conventions |
| `HEARTBEAT.md` | Optional recurring checklist |
| `BOOT.md` | Optional startup checklist |
| `BOOTSTRAP.md` | One-time setup ritual |
| `memory/YYYY-MM-DD.md` | Daily memory notes |
| `MEMORY.md` | Curated long-term memory |
| `skills/` | Workspace-specific skills |

### 15.8 Agent separation pattern

```text
Main Agent
  - general/private assistant

Support Agent
  - ticket tags
  - draft replies
  - customer risk flags

Ops Agent
  - scripts
  - automations
  - internal process support

Finance Agent
  - reports
  - cash summaries
  - read-only financial analysis

CEO Agent
  - dashboard questions
  - executive summaries
  - business-wide queries
```

### 15.9 Skill rules

Good skill:

- narrow purpose,
- clear trigger,
- explicit steps,
- safe defaults,
- clear output format,
- restricted permissions.

Bad skill:

- does everything,
- vague instructions,
- broad access,
- no safety rules,
- no error handling,
- writes/sends/deletes without approval.

### 15.10 Production checklist

Before putting OpenClaw into serious use:

- [ ] Gateway is not publicly exposed without protection.
- [ ] Channels use pairing or allowlists.
- [ ] Group chats require mentions.
- [ ] Agents are separated by responsibility.
- [ ] Sensitive agents have limited skills.
- [ ] Finance/customer data is protected.
- [ ] API keys are not in workspace files.
- [ ] Logs and errors are monitored.
- [ ] API timeouts have retry/fallback behavior.
- [ ] Model costs are tracked.
- [ ] Human approval exists for risky actions.
- [ ] Legacy workflows are documented.
- [ ] There is a rollback plan.

### 15.11 Job-specific phrase bank

Use these phrases carefully and honestly.

#### If you are still learning

> I am learning OpenClaw from the public docs and understand its Gateway/channel/agent/workspace/skills architecture. I would treat your existing OpenClaw setup as a legacy internal system and audit it before proposing migration.

#### If asked how you would start

> I would start by mapping the current Gateway config, active channels, agent bindings, workspaces, skills, provider keys, and external APIs. Then I would classify each legacy dependency as keep, migrate, retire, or rebuild.

#### If asked about support automation

> I would separate ticket classification, draft generation, and at-risk escalation into distinct workflows, then benchmark model choices by accuracy, latency, and cost before deciding whether to keep the old OpenAI classifier or rebuild it.

#### If asked about Slack

> I would treat Slack as the interaction layer, not the business logic layer. Slack events should route through the Gateway to scoped agents with clear permissions and logging.

#### If asked about cost routing

> I would document current model usage by job type, define model selection standards, track cost and latency, and ensure cheap models handle classification while stronger models handle complex reasoning.

---

## 16. Final practical takeaway

For this job, OpenClaw is not the whole role. It is one piece of a larger AI operations architecture.

The real job is about:

- ownership,
- auditing,
- migration,
- model selection,
- cost governance,
- production reliability,
- team training,
- connecting disconnected systems.

OpenClaw matters because it gives you a vocabulary for:

- agents,
- channels,
- routing,
- skills,
- workspaces,
- sessions,
- model-backed automations.

But the company’s actual setup may be custom or legacy. So the strongest answer is not “I know every OpenClaw command.” The strongest answer is:

> I understand the architecture, I know what to inspect, I know how to separate workflows safely, and I would make migration decisions based on evidence, cost, reliability, and business impact.
