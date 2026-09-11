# Interactive examples: run one region at a time in the same Bash terminal.
# After checking run.finished in the stream, press Ctrl+C and run cleanup.

#region create
ZOOWORK_BASE_URL="${ZOOWORK_BASE_URL:-https://clawapi.ecap.gsmo.ai/service/v1}"

agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"resource":{"name":"quickstart-agent","onboarding":false}}')

AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
echo "Agent ID: $AGENT_ID"
#endregion create

#region start
curl -sS --fail-with-body -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"

curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  | jq -r '.status.desired_state'
#endregion start

#region session
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}')

SESSION_ID=$(jq -er '.session_id' <<<"$session")
echo "Session ID: $SESSION_ID"
#endregion session

#region send
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{
    "type":"user.message",
    "content":"Create report.md with a sales table: January $100, February $120, March $80. Include the total. Read the file to verify it, then report the total."
  }]}'
#endregion send

#region stream
curl -N -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
#endregion stream

#region cleanup
curl -sS --fail-with-body -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" &&
curl -sS --fail-with-body -X DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
#endregion cleanup
