# region create
import asyncio

from zoowork import (
    assistant_text,
    create_zoowork_client,
    is_run_finished,
    run_outcome,
    tool_call,
)


async def main() -> None:
    async with create_zoowork_client() as client:
        agent = await client.create_agent({"name": "quickstart-agent"})
        agent_id = str(agent["agent_id"])
        print(f"Agent ID: {agent_id}")
# endregion create

# region start
# Continue inside main().
        await client.start_agent(agent_id)
# endregion start

# region session
# Continue inside main().
        session = await client.create_session(agent_id)
        session_id = str(session["session_id"])
        print(f"Session ID: {session_id}")
# endregion session

# region send
# Continue inside main().
        receipt = await client.post_events(
            agent_id,
            session_id,
            [{
                "type": "user.message",
                "content": (
                    "Create report.md with a sales table: January $100, February $120, "
                    "March $80. Include the total. Read the file to verify it, then report "
                    "the total."
                ),
            }],
        )
        if not receipt or receipt[0].get("accepted") is not True:
            raise RuntimeError("Message was not accepted")
# endregion send

# region stream
# Continue inside main().
        outcome = None
        async for event in client.stream_events(agent_id, session_id):
            print(assistant_text(event), end="", flush=True)
            call = tool_call(event)
            if call is not None and call.phase == "start":
                print(f"\n[tool] {call.tool_name}")

            if is_run_finished(event):
                outcome = run_outcome(event)
                print(f"\nTurn: {outcome}")
                break

        if outcome != "succeeded":
            raise RuntimeError(f"Turn did not succeed: {outcome or 'stream closed'}")
# endregion stream

# region cleanup
# Finish inside main(), then run it.
        await client.stop_agent(agent_id)
        await client.delete_agent(agent_id)


if __name__ == "__main__":
    asyncio.run(main())
# endregion cleanup
