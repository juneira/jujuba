package openai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func strPtr(s string) *string {
	return &s
}
