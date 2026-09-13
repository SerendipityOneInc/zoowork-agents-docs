---
description: Learn how managed execution forms agent trajectories, how outcomes label them, and how both support evaluation and post-training.
---

# Agent trajectories

Managed Agents does more than return a final answer. It preserves the steps an agent takes
while working: messages, model output, tool calls and results, and completion events. When
those records are organized around one task, they describe an **agent trajectory**. An
outcome is a separate label that says whether the trajectory produced a useful or correct result.

Together, trajectories and outcomes connect production execution to model improvement. The
runtime captures execution, evaluation labels and selects useful behavior, post-training
learns from selected examples, and the resulting model returns to the runtime.

## One task, recorded end to end

![One task enters the Managed Agents runtime, where the model exchanges actions and observations with tools and the environment until it produces a result. Context, decisions, actions, observations, and result form the trajectory. A separate outcome label records whether it was useful or correct; together they support evaluation and post-training.](https://assets.yesy.site/f/images/2026/09/gqzh1y9q.png)

[View the trajectory diagram full size](https://assets.yesy.site/f/images/2026/09/gqzh1y9q.png)

A **trajectory** is the ordered path an agent takes through one task, from its starting context
to its result. It contains more than the transcript.

| Part | What it records |
|---|---|
| **Task and context** | What the agent was asked to do and the state it could use. |
| **Decisions** | Model responses that selected the next action or produced an answer. |
| **Actions** | Tool calls made by the agent. |
| **Observations** | Tool results, command output, errors, and other environment feedback. |
| **Result** | The answer, file, artifact, or external change produced by the task. |

Here, **decisions** means recorded model responses and observable action choices. It does not
mean private chain-of-thought that the model or API does not expose.

An **outcome** is a quality or business signal attached to the trajectory, not another step
inside it. For a sales-report task, the report file is the result. An outcome could record
whether its totals passed a deterministic check, whether a reviewer accepted it, or whether
the report met an evaluation rubric.

::: info A trajectory is not automatically training data
A trajectory without an outcome is still a valid record of agent behavior. It becomes a
graded evaluation example or a candidate training example only after you attach the relevant
outcome and apply the required curation and data controls.

A `run.finished` event reports how a run ended: `succeeded`, `failed`, or `aborted`. It is not
a quality score. A run can finish successfully and still produce an incorrect or unhelpful
answer. The outcome must represent the standard that matters for the task.
:::

## Session events, trajectories, and traces

These terms describe different views of the same work.

| Term | Meaning in this documentation | Public API surface |
|---|---|---|
| **Session** | A persistent conversation with one Agent. It can contain multiple turns. | A resource addressed by `agent_id` and `session_id`. |
| **Turn** | One user message and the work the agent performs in response. | Observed through `run.started` and `run.finished`; there is no separate Run resource. |
| **Event** | One durable, sequenced record inside a Session. | Read through the event list or resumable SSE stream. |
| **Trajectory** | A task-level ordered path through context, model output, actions, observations, and result. | A concept assembled from Session records, not a first-class resource. |
| **Trace / span** | An observability view that groups recorded execution steps, often with timing and status. | Trace and span objects are not exposed by the Managed Agents public API. |

A trace is useful for inspecting how execution behaved. A trajectory is useful for analyzing
the behavior as a task-level path. Once labeled with an outcome, it can become an evaluation
example, a preference signal, or a reinforcement signal. One execution can contribute to
both views, but the terms are not interchangeable.

Today, use `listAllEvents(agentId, sessionId)` for the complete ordered event history and
`getSession(agentId, sessionId, { history: true })` for the stored transcript. Keep your own
task identifier, result reference, and outcome beside those records.

::: warning Current API boundary
Managed Agents captures the runtime side of this loop. The public API does not currently
provide a trajectory-export resource, a session-level outcome definition, or a post-training
job endpoint. Your application owns the outcome labels, training dataset, and downstream
training workflow. See [Not supported](../reference/not-supported.md#outcome-definitions-on-interactive-sessions).
:::

## Outcomes turn trajectories into learning data

The trajectory says what happened. An outcome says whether it was worth repeating.
Without that second signal, failures and strong examples can look structurally identical.

An outcome can come from several places:

- **A deterministic check**, such as a test passing or a record reaching the expected state.
- **A rubric evaluator** that scores the result against written criteria.
- **Human judgment**, such as accept, reject, or a comparison between two results.
- **A business signal**, such as a resolved support case or a completed workflow.

Record the outcome's source and evaluator version with the label. A score without its criteria
cannot be reproduced or compared after the evaluator changes. Before using production
trajectories for training, remove secrets and data that the training process is not authorized
to retain.

## Production and post-training form one loop

![A six-stage loop deploys a model into the Managed Agents runtime, runs real tasks, collects trajectories with outcomes, evaluates and curates them, post-trains a model, and returns a new model version to deployment.](https://assets.yesy.site/f/images/2026/09/8ljp3d8r.png)

[View the model-improvement loop full size](https://assets.yesy.site/f/images/2026/09/8ljp3d8r.png)

The outer loop works across many tasks:

1. **Deploy a model.** Configure an Agent to use a model in the managed runtime.
2. **Run real tasks.** The model works with the tools, permissions, files, and environment the application provides.
3. **Retain trajectories with outcomes.** Preserve the ordered execution and attach the signal that says whether the result was good.
4. **Evaluate and curate.** Find successful behavior, recurring failures, and examples that are safe and useful for training.
5. **Post-train.** Strong trajectories can become supervised examples; comparisons can become preference data; tasks with verifiable outcomes can provide reinforcement signals.
6. **Deploy the new model version.** Run it in the same task environment, compare its outcomes, and begin the next cycle.

The continuity matters. Training data reflects the tools and feedback the model sees in
production, and the improved model returns to those operating conditions. Managed Agents is
therefore both the execution layer where agent work happens and the source of the structured
behavioral record used to improve future models.

## What to retain

For each task that may become a trajectory, retain:

- your stable task identifier together with `agent_id` and `session_id`;
- the complete ordered event history, not only the final assistant message;
- the result or artifact reference needed to evaluate the task;
- the outcome label, its source, and the evaluator version;
- enough Agent, model, tool, and environment version information to reproduce the conditions.

The Managed Agents API does not supply every field in one object. Store the application-owned
parts in your database and join them to the Session records you read from ZooWork.

## Next steps

- [Architecture](./architecture.md): see how the managed runtime, model, tools, and sandbox fit together.
- [Sessions](../build/sessions.md): create and continue the conversations that contain agent work.
- [Events and streaming](../build/events.md): read the ordered execution record and resume a stream.
- [Capability matrix](../reference/capabilities.md): check which runtime surfaces have been verified.

## Check your understanding

::: details Is a trajectory the same thing as a Session?
No. A Session is a persistent conversation and can contain several turns or tasks. A trajectory
is the ordered behavior path for one task. An outcome can be attached to that path separately.
:::

::: details Does a trajectory contain the model's private chain-of-thought?
Not necessarily. In this documentation, a trajectory contains recorded model output,
observable actions, and environment feedback. Do not infer reasoning that the model or API
does not expose.
:::

::: details Does `run.finished` with `succeeded` mean the task produced a good result?
No. It describes how the run ended, not whether the result met the task's quality or business
criteria. Attach a separate outcome signal.
:::

::: details Does Managed Agents currently run post-training jobs?
Not through the public API. It captures the production execution history; your application
currently owns outcome labels, dataset preparation, and the post-training workflow.
:::
