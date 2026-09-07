package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/juneira/jujuba/chat"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{},
	}
}

func (c *Client) Ask(ch *chat.Chat) (*chat.MessageType, error) {
	messages := make([]ChatCompletionRequestMessage, 0, len(ch.Messages()))
	for _, msg := range ch.Messages() {
		content := msg.Content
		messages = append(messages, ChatCompletionRequestMessage{
			Role:    string(msg.Role),
			Content: ChatCompletionRequestMessageContent{Text: &content},
		})
	}

	f := false
	req := CreateChatCompletionRequest{
		Messages: messages,
		Model:    ModelIdsShared(ch.Model),
		Stream:   &f,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
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
