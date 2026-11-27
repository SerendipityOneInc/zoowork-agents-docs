// #region create
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	zoowork "github.com/SerendipityOneInc/zoowork-sdk-go"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	client, err := zoowork.NewClient(zoowork.Config{})
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()

	agent, err := client.CreateAgent(ctx, zoowork.Object{
		"resource": zoowork.Object{"name": "quickstart-agent"},
	}, "")
	if err != nil {
		return err
	}
	agentID, ok := agent["agent_id"].(string)
	if !ok || agentID == "" {
		return errors.New("Agent response is missing agent_id")
	}
	fmt.Printf("Agent ID: %s\n", agentID)
	defer func() { err = errors.Join(err, cleanUp(client, agentID)) }()
	// #endregion create

	// #region start
	if _, err := client.StartAgent(ctx, agentID); err != nil {
		return err
	}
	if _, err := client.WaitUntilRunning(ctx, agentID, zoowork.WaitOptions{}); err != nil {
		return err
	}
	// #endregion start

	// #region session
	session, err := client.CreateSession(ctx, agentID, zoowork.Object{}, "")
	if err != nil {
		return err
	}
	sessionID, ok := session["session_id"].(string)
	if !ok || sessionID == "" {
		return errors.New("Session response is missing session_id")
	}
	fmt.Printf("Session ID: %s\n", sessionID)
	// #endregion session

	// #region send
	receipts, err := client.PostEvents(ctx, agentID, sessionID, []zoowork.Object{{
		"type": "user.message",
		"content": "Create report.md with a sales table: January $100, February $120, March $80. " +
			"Include the total. Read the file to verify it, then report the total.",
	}})
	if err != nil {
		return err
	}
	if len(receipts) == 0 || receipts[0]["accepted"] != true {
		return errors.New("Message was not accepted")
	}
	// #endregion send

	// #region stream
	for event, err := range client.StreamEvents(ctx, agentID, sessionID, zoowork.StreamEventsOptions{}) {
		if err != nil {
			return err
		}
		fmt.Print(zoowork.AssistantText(event))
		if call := zoowork.ExtractToolCall(event); call != nil && call.Phase == "start" {
			fmt.Printf("\n[tool] %s\n", call.ToolName)
		}
		if zoowork.IsRunFinished(event) {
			outcome := zoowork.RunOutcome(event)
			fmt.Printf("\nTurn: %s\n", outcome)
			if outcome != "succeeded" {
				return fmt.Errorf("turn did not succeed: %s", outcome)
			}
			return nil
		}
	}
	return errors.New("stream closed before run.finished")
	// #endregion stream

	// #region cleanup
}

func cleanUp(client *zoowork.Client, agentID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := client.StopAgent(ctx, agentID); err != nil {
		return fmt.Errorf("stop Agent %s: %w", agentID, err)
	}
	if err := client.DeleteAgent(ctx, agentID); err != nil {
		return fmt.Errorf("delete Agent %s: %w", agentID, err)
	}
	return nil
}

// #endregion cleanup
