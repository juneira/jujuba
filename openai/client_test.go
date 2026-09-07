package openai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/juneira/jujuba/chat"
)

func TestNewClient(t *testing.T) {
	c := NewClient("http://localhost:1234", "")
	if c.baseURL != "http://localhost:1234" {
		t.Errorf("expected baseURL 'http://localhost:1234', got '%s'", c.baseURL)
	}
	if c.httpClient == nil {
		t.Error("expected non-nil httpClient")
	}
}

func TestAsk_RequestFormat(t *testing.T) {
	var capturedReq CreateChatCompletionRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("expected /v1/chat/completions, got %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedReq); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		resp := CreateChatCompletionResponse{
			ID:      "chatcmpl-123",
			Object:  "chat.completion",
			Created: 1234567890,
			Model:   "deepseek-v3",
			Choices: []ChatCompletionChoice{
				{
					Index: 0,
					Message: ChatCompletionResponseMessage{
						Role:    "assistant",
						Content: strPtr("hello from server"),
					},
					FinishReason: "stop",
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "deepseek-v3")
	_, err := ch.Ask("hello world")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(capturedReq.Messages) != 1 {
		t.Fatalf("expected 1 message in request, got %d", len(capturedReq.Messages))
	}
	if capturedReq.Messages[0].Role != "user" {
		t.Errorf("expected role 'user', got '%s'", capturedReq.Messages[0].Role)
	}
	if capturedReq.Model != "deepseek-v3" {
		t.Errorf("expected model 'deepseek-v3', got '%s'", capturedReq.Model)
	}
	if capturedReq.Stream == nil || *capturedReq.Stream != false {
		t.Errorf("expected stream=false, got %v", capturedReq.Stream)
	}
}

func TestAsk_SuccessResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := CreateChatCompletionResponse{
			ID:      "chatcmpl-123",
			Object:  "chat.completion",
			Created: 1234567890,
			Model:   "test-model",
			Choices: []ChatCompletionChoice{
				{
					Index: 0,
					Message: ChatCompletionResponseMessage{
						Role:    "assistant",
						Content: strPtr("parsed response"),
					},
					FinishReason: "stop",
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	resp, err := ch.Ask("prompt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != "parsed response" {
		t.Errorf("expected 'parsed response', got '%s'", resp)
	}
}

func TestAsk_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.Ask("prompt")

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestAsk_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.Ask("prompt")

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestAsk_EmptyChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := CreateChatCompletionResponse{
			ID:      "chatcmpl-123",
			Object:  "chat.completion",
			Created: 1234567890,
			Model:   "test-model",
			Choices: []ChatCompletionChoice{},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.Ask("prompt")

	if err == nil {
		t.Fatal("expected error for empty choices, got nil")
	}
}

func TestAsk_NilContent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := CreateChatCompletionResponse{
			ID:      "chatcmpl-123",
			Object:  "chat.completion",
			Created: 1234567890,
			Model:   "test-model",
			Choices: []ChatCompletionChoice{
				{
					Index: 0,
					Message: ChatCompletionResponseMessage{
						Role:    "assistant",
						Content: nil,
					},
					FinishReason: "stop",
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	resp, err := ch.Ask("prompt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != "" {
		t.Errorf("expected empty string for nil content, got '%s'", resp)
	}
}

func TestMarshalJSON_ContentText(t *testing.T) {
	c := ChatCompletionRequestMessageContent{Text: strPtr("hello")}
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `"hello"` {
		t.Errorf("expected '\"hello\"', got '%s'", string(data))
	}
}

func TestMarshalJSON_ContentParts(t *testing.T) {
	c := ChatCompletionRequestMessageContent{
		Parts: []ChatCompletionRequestMessageContentPartText{
			{Type: "text", Text: "part1"},
		},
	}
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `[{"type":"text","text":"part1"}]` {
		t.Errorf("unexpected parts JSON: %s", string(data))
	}
}

func TestMarshalJSON_ContentEmpty(t *testing.T) {
	c := ChatCompletionRequestMessageContent{}
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `""` {
		t.Errorf("expected '\"\"', got '%s'", string(data))
	}
}

func TestUnmarshalJSON_ContentText(t *testing.T) {
	var c ChatCompletionRequestMessageContent
	if err := json.Unmarshal([]byte(`"hello"`), &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.Text == nil || *c.Text != "hello" {
		t.Errorf("expected Text='hello', got %v", c.Text)
	}
}

func TestUnmarshalJSON_ContentParts(t *testing.T) {
	var c ChatCompletionRequestMessageContent
	if err := json.Unmarshal([]byte(`[{"type":"text","text":"p"}]`), &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.Parts == nil || len(c.Parts) != 1 || c.Parts[0].Text != "p" {
		t.Errorf("expected Parts with text 'p', got %v", c.Parts)
	}
}

func TestUnmarshalJSON_ContentEmptyString(t *testing.T) {
	var c ChatCompletionRequestMessageContent
	if err := json.Unmarshal([]byte(`""`), &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.Text == nil || *c.Text != "" {
		t.Errorf("expected Text='', got %v", c.Text)
	}
}

func TestUnmarshalJSON_ContentInvalid(t *testing.T) {
	var c ChatCompletionRequestMessageContent
	err := json.Unmarshal([]byte(`42`), &c)
	if err == nil {
		t.Fatal("expected error for number, got nil")
	}
}

func TestAskStream_RequestStreamTrue(t *testing.T) {
	var capturedReq CreateChatCompletionRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&capturedReq); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.AskStream("hello", func(string) {})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedReq.Stream == nil || *capturedReq.Stream != true {
		t.Errorf("expected stream=true, got %v", capturedReq.Stream)
	}
	if capturedReq.Model != "test-model" {
		t.Errorf("expected model 'test-model', got '%s'", capturedReq.Model)
	}
}

func TestAskStream_SSEAccumulation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, strings.Join([]string{
			`: keep-alive`,
			`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}`,
			``,
			`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"lo"}}]}`,
			``,
			`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
			``,
			`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`,
			``,
			`data: [DONE]`,
			``,
		}, "\n"))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")

	var deltas []string
	resp, err := ch.AskStream("prompt", func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp != "Hello" {
		t.Errorf("expected 'Hello', got '%s'", resp)
	}
	if len(deltas) != 2 || deltas[0] != "Hel" || deltas[1] != "lo" {
		t.Errorf("unexpected deltas: %v", deltas)
	}

	msgs := ch.Messages()
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[1].Role != chat.RoleAssistant || msgs[1].Content != "Hello" {
		t.Errorf("unexpected assistant message: %+v", msgs[1])
	}
}

func TestAskStream_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.AskStream("prompt", func(string) {})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestAskStream_MalformedChunk(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {invalid\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "")
	ch := chat.New(client, "test-model")
	_, err := ch.AskStream("prompt", func(string) {})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRequestOmitsEmptyResponseFormatAndStop(t *testing.T) {
	body, err := json.Marshal(CreateChatCompletionRequest{
		Messages: []ChatCompletionRequestMessage{{Role: "user"}},
		Model:    "test-model",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := m["response_format"]; ok {
		t.Errorf("expected response_format to be omitted, got: %s", string(body))
	}
	if _, ok := m["stop"]; ok {
		t.Errorf("expected stop to be omitted, got: %s", string(body))
	}
}

func strPtr(s string) *string {
	return &s
}
