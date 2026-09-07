package openai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/juneira/jujuba/chat"
)

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewClient(baseURL string, apiKey string) *Client {
	return &Client{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{},
	}
}

func buildRequestMessages(ch *chat.Chat) []ChatCompletionRequestMessage {
	messages := make([]ChatCompletionRequestMessage, 0, len(ch.Messages()))
	for _, msg := range ch.Messages() {
		content := msg.Content
		messages = append(messages, ChatCompletionRequestMessage{
			Role:    string(msg.Role),
			Content: ChatCompletionRequestMessageContent{Text: &content},
		})
	}
	return messages
}

func (c *Client) send(req *CreateChatCompletionRequest) (*http.Response, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http post: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	return resp, nil
}

func (c *Client) Ask(ch *chat.Chat) (*chat.MessageType, error) {
	stream := false
	resp, err := c.send(&CreateChatCompletionRequest{
		Messages: buildRequestMessages(ch),
		Model:    ModelIdsShared(ch.Model),
		Stream:   &stream,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var completion CreateChatCompletionResponse
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if len(completion.Choices) == 0 {
		return nil, fmt.Errorf("no choices in response")
	}

	content := ""
	if completion.Choices[0].Message.Content != nil {
		content = *completion.Choices[0].Message.Content
	}

	return &chat.MessageType{
		Role:    chat.RoleAssistant,
		Content: content,
	}, nil
}

func (c *Client) AskStream(ch *chat.Chat, onDelta func(string)) (*chat.MessageType, error) {
	stream := true
	resp, err := c.send(&CreateChatCompletionRequest{
		Messages: buildRequestMessages(ch),
		Model:    ModelIdsShared(ch.Model),
		Stream:   &stream,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var content strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}

		var chunk CreateChatCompletionStreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return nil, fmt.Errorf("unmarshal stream chunk: %w", err)
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		if deltaContent := chunk.Choices[0].Delta.Content; deltaContent != nil {
			content.WriteString(*deltaContent)
			if onDelta != nil {
				onDelta(*deltaContent)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read stream: %w", err)
	}

	return &chat.MessageType{
		Role:    chat.RoleAssistant,
		Content: content.String(),
	}, nil
}
