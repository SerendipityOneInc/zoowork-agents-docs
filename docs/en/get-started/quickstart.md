---
description: Create your first agent, start a session, and stream its response using TypeScript or curl.
---

# Quickstart

Create an agent, start a session, and stream its response. In this guide, the agent turns
three months of sales data into a report, saves it as `report.md`, and reads it back to verify the total.

## Core concepts

| Concept | Description |
|---|---|
| Agent | The configuration you create and start, including the model, tools, and skills. |
| Session | A conversation with an agent, containing your messages and its work. |
| Events | Messages, tool activity, replies, and turn results exchanged through a session. |

This guide uses the default model and sandbox. You can [configure an Environment](../build/environments.md)
when you need a custom sandbox; no separate Environment is required here.

## Prerequisites

- A ZooWork organization API key (`zct_...`). [Get an API key](https://zoowork.ai/identity?tab=account-api-keys).
- **TypeScript:** Node.js **22.20+** and npm.
- **curl:** Bash, curl **7.76+**, and `jq` **1.6+**.

## Set up

Choose TypeScript or curl and use that tab throughout the guide.

::: code-group

```bash [TypeScript]
npm install @zoowork-ai/sdk
```

```bash [curl]
curl --version
jq --version
```

:::

Set your API key in the terminal:

```bash
export ZOOWORK_API_KEY='zct_...'
```

::: warning Keep your key private
Run these examples on your server or local development machine. Do not put the key in browser code or the agent's sandbox.
:::

**TypeScript:** Copy the TypeScript blocks below into `quickstart.mts` in order, including
cleanup. Run the file with the command at the end of the guide.

**curl:** Run each block in the same Bash terminal. Check that each request succeeds before
continuing. The commands save the returned IDs for the next step.

## Create your first session

### 1. Create an agent

Create an agent and save its ID. The SDK reads `ZOOWORK_API_KEY` and uses the public API URL
by default. The curl example sets the URL explicitly.

::: code-group

<<< ../../snippets/quickstart.ts#create [TypeScript]

<<< ../../snippets/quickstart.sh#create [curl]

:::

The curl request sets `onboarding: false`, which the SDK supplies automatically.

### 2. Start the agent

Start the agent before creating a session.

::: code-group

<<< ../../snippets/quickstart.ts#start [TypeScript]

<<< ../../snippets/quickstart.sh#start [curl]

:::

See [Agent lifecycle](../build/agents.md) for startup errors.

### 3. Create a session

Create a session for this task and save its `session_id`.

::: code-group

<<< ../../snippets/quickstart.ts#session [TypeScript]

<<< ../../snippets/quickstart.sh#session [curl]

:::

### 4. Send a message and stream the response

Ask the agent to create a sales report. The message contains all the data, so no input file
or external service is needed.

::: code-group

<<< ../../snippets/quickstart.ts#send [TypeScript]

<<< ../../snippets/quickstart.sh#send [curl]

:::

The response's `events[0].accepted` should be `true`. This means the message was accepted;
read the event stream to see the agent's work and result. Events are saved, so you can read
them even if the agent starts working before you connect.

::: code-group

<<< ../../snippets/quickstart.ts#stream [TypeScript]

<<< ../../snippets/quickstart.sh#stream [curl]

:::

**TypeScript** prints the reply and tool activity, then closes the connection at `run.finished`.
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

```text [curl]
event: event
data: {"event_type":"agent.assistant","payload":{"message":{"content":[{"type":"text","text":"I saved report.md and verified total sales of $300."}]}}}

event: event
data: {"event_type":"run.finished","payload":{"status":"succeeded"}}
```

:::

::: tip If the turn does not succeed
For `failed`, `aborted`, or a connection that closes before `run.finished`, inspect the
[session history](../build/sessions.md) before retrying. You can still use the cleanup requests below.
:::

## What's happening

When you send the message, ZooWork:

1. Runs the agent, which decides which tools to use for the task.
2. Creates or reuses a managed sandbox as needed to execute tools and save `report.md`.
3. Saves and streams events as the agent works.
4. Emits `run.finished` with the turn's result. The session remains available for a follow-up message.

## Clean up

When you finish the example, stop the agent to release its sandbox, then delete the agent.
Save anything you want to keep first. If stopping fails, resolve the error before deleting.

::: code-group

<<< ../../snippets/quickstart.ts#cleanup [TypeScript]

<<< ../../snippets/quickstart.sh#cleanup [curl]

:::

Run the assembled TypeScript example with:

```bash
node quickstart.mts
```

If the program exits early, use the printed agent ID with the cleanup requests above.
For curl, run cleanup after pressing Ctrl+C to close the stream.

## Next steps

- [Agents](../build/agents.md): choose a model, tools, and skills.
- [Sessions](../build/sessions.md): continue the conversation and read its history.
- [Events and streaming](../build/events.md): handle events, timeouts, and reconnection.
- [Example apps](https://github.com/SerendipityOneInc/zoowork-quickstarts): build a complete application.
- [Coding assistant skill](https://github.com/SerendipityOneInc/zoowork-sdk-skills): give your coding assistant ZooWork SDK guidance.
