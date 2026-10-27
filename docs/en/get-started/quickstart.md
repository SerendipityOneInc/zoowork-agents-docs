---
description: Create your first agent, start a session, and stream its response using TypeScript, Python, or curl.
---

# Quickstart

Create an agent, start a session, and stream its response. In this guide, the agent turns
three months of sales data into a report, saves it as `report.md`, and reads it back to verify the total.

Hand this prompt to Claude Code, Codex, Cursor, or another coding assistant from your project
directory. It reads this documentation before writing code and asks before anything billable.

<AgentPrompt id="use-a-coding-assistant" title="Add ZooWork to your project">

```text
Build on ZooWork Managed Agents in this project.

Read https://zoowork.ai/docs/get-started/quickstart.md before writing
code. For anything else, find the page in
https://zoowork.ai/docs/llms.txt and read only the pages this task
needs. Read each page in full: fetch the raw Markdown, for example
with curl, or ask your fetch tool for the complete text, because a
summary can drop code. The API is a Developer Preview, so do not
write ZooWork code from memory.

Before writing code:
1. Inspect the project and choose the TypeScript SDK (@zoowork-ai/sdk)
   or the Python SDK (zoowork). If one is already installed, use that
   version; do not upgrade it without asking.
2. Check whether ZOOWORK_API_KEY is set, without printing its value.
   If it is missing, ask me to create an API key and add funds at
   https://platform.zoowork.ai, then set the variable myself. Never
   ask me to paste the key into this conversation.
3. Keep the key in server-side code. Never put it in browser code or
   in the Agent's sandbox.

Agent tasks use the organization's prepaid balance. Show me your plan
and wait for my approval before the first request that creates or
starts an Agent. Do not estimate the cost; tell me to check Usage in
ZooWork Platform for actual charges.

When the integration works, offer to run
`npx skills add SerendipityOneInc/zoowork-sdk-skills` so future
sessions in this project start from these docs.
```

</AgentPrompt>

Or follow the steps below yourself.

## The resources you will use

| Resource | Description |
|---|---|
| Agent | The configuration you create and start, including the model, tools, and skills. |
| Session | A conversation with an agent, containing your messages and its work. |
| Events | Messages, tool activity, replies, and turn results exchanged through a session. |

This guide uses the default model and managed sandbox. No separate Environment is required.

## Prerequisites

The SDK examples in this documentation use TypeScript SDK **0.13.0+** and Python SDK **0.8.0+**.

- An API key and a funded organization balance. Follow [Authentication and API keys](./authentication.md) to create the key and add funds in ZooWork Platform.
- **TypeScript:** Node.js **22 or later** and npm. Use the latest security release of your Node.js line; Node.js 20 is end of life.
- **Python:** Python **3.11 or later** and pip. Python 3.10 is end of life.
- **curl:** Bash, curl **7.76+**, and `jq` **1.6+**.

## Set up

Choose TypeScript, Python, or curl and use that tab throughout the guide.

::: code-group

```bash [TypeScript]
npm install @zoowork-ai/sdk
```

```bash [Python]
python -m pip install zoowork
```

```bash [curl]
curl --version
jq --version
```

:::

Set your API key in the terminal:

```bash
export ZOOWORK_API_KEY='zwp_live_...'
```

::: warning Keep your key private
Run these examples on your server or local development machine. Do not put the key in browser code or the agent's sandbox.
:::

**TypeScript:** Copy the TypeScript blocks below into `quickstart.mts` in order, including
cleanup. Run the file with the command at the end of the guide.

**Python:** Copy the Python blocks below into `quickstart.py` in order. The blocks include
their required indentation. Run the file with the command at the end of the guide.

**curl:** Complete the [HTTP setup in Authentication](./authentication.md#use-http) first, including `ZOOWORK_BASE_URL`. Run each block in the same Bash terminal. Check that each request succeeds before continuing. The commands save the returned IDs for the next step.

## Create your first session

### 1. Create an agent

Create an agent and save its ID. The SDK reads `ZOOWORK_API_KEY`. The curl example reuses the variables configured in Authentication.

::: code-group

<<< ../../snippets/quickstart.ts#create [TypeScript]

<<< ../../snippets/quickstart.py#create [Python]

<<< ../../snippets/quickstart.sh#create [curl]

:::

The curl request sets `onboarding: false`, which the SDK supplies automatically.

### 2. Start the agent

Start the agent before creating a session. The SDK examples then wait until its desired state is
`running`; the curl start request returns once that state is set.

::: code-group

<<< ../../snippets/quickstart.ts#start [TypeScript]

<<< ../../snippets/quickstart.py#start [Python]

<<< ../../snippets/quickstart.sh#start [curl]

:::

See [Agent lifecycle](../build/agents.md) for startup errors.

### 3. Create a session

Create a session for this task and save its `session_id`.

::: code-group

<<< ../../snippets/quickstart.ts#session [TypeScript]

<<< ../../snippets/quickstart.py#session [Python]

<<< ../../snippets/quickstart.sh#session [curl]

:::

### 4. Send a message and stream the response

Ask the agent to create a sales report. The message contains all the data, so no input file
or external service is needed.

::: code-group

<<< ../../snippets/quickstart.ts#send [TypeScript]

<<< ../../snippets/quickstart.py#send [Python]

<<< ../../snippets/quickstart.sh#send [curl]

:::

The SDK examples stop if the receipt does not mark the message as accepted. With curl,
confirm that the response's `events[0].accepted` is `true`. Then read the event stream to see
the agent's work and result. Events are saved, so you can read them even if the agent starts
working before you connect.

::: code-group

<<< ../../snippets/quickstart.ts#stream [TypeScript]

<<< ../../snippets/quickstart.py#stream [Python]

<<< ../../snippets/quickstart.sh#stream [curl]

:::

**TypeScript and Python** print the reply and tool activity, then close the connection at
`run.finished`.
**curl** displays the raw event stream. When you see `event_type: "run.finished"`, check
`payload.status`, then press **Ctrl+C** to return to your terminal. The stream stays open
for future turns until you close it.

A successful turn has status `succeeded`. The agent's reply should also confirm that it
saved the report and verified total sales of **$300**. Tool names and wording vary;
the following output is illustrative, with only selected fields shown for curl:

::: code-group

```text [TypeScript]
[tool] exec
I saved report.md and read it back to verify the three monthly sales and the $300 total.
Turn: succeeded
```

```text [Python]
[tool] exec
I saved report.md and read it back to verify the three monthly sales and the $300 total.
Turn: succeeded
```

```text [curl]
event: event
data: {"event_type":"agent.assistant","payload":{"message":{"content":[{"type":"text","text":"I saved report.md and verified total sales of $300."}]}}}

event: event
data: {"event_type":"run.finished","payload":{"status":"succeeded"}}
```

:::

::: tip If the turn does not succeed
For `failed`, `aborted`, or a connection that closes before `run.finished`, inspect the
[session history](../build/session-operations.md#the-transcript-getsession-history-true) before retrying. You can still use the cleanup requests below.
:::

## What's happening

When you send the message, ZooWork:

1. Runs the agent, which decides which tools to use for the task.
2. Creates or reuses a managed sandbox as needed to execute tools and save `report.md`.
3. Saves and streams events as the agent works.
4. Emits `run.finished` with the turn's result. The session remains available for a follow-up message.

## Clean up

When you finish the example, stop the agent so it takes no more work, then delete the agent.
Save anything you want to keep first. If stopping fails, resolve the error before deleting.

::: code-group

<<< ../../snippets/quickstart.ts#cleanup [TypeScript]

<<< ../../snippets/quickstart.py#cleanup [Python]

<<< ../../snippets/quickstart.sh#cleanup [curl]

:::

Run the assembled TypeScript example with:

```bash
node quickstart.mts
```

Run the assembled Python example with:

```bash
python quickstart.py
```

If the program exits early, use the printed agent ID with the cleanup requests above.
For curl, run cleanup after pressing Ctrl+C to close the stream. Both SDK programs close their
HTTP client when they exit.

## Next steps

- [Architecture](./architecture.md): managed execution, persistent state, and on-demand compute.
- [Agents](../build/agents.md): choose a model, tools, and skills.
- [Start a session](../build/sessions.md): create and continue a conversation.
- [Session operations](../build/session-operations.md): read history and manage saved Sessions.
- [Events and streaming](../build/events.md): handle events, timeouts, and reconnection.
- [Agent Starter](https://github.com/SerendipityOneInc/zoowork-platform-quickstarts/tree/main/starter): start a complete chat app for one Agent from a template.
- [Example apps](https://github.com/SerendipityOneInc/zoowork-platform-quickstarts): complete applications that each show one capability, such as custom tools or remote MCP.
- [Coding assistant skill](https://github.com/SerendipityOneInc/zoowork-sdk-skills): give your coding assistant ZooWork SDK guidance.
