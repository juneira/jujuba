package chat

import (
	"fmt"
	"testing"
)

type mockProvider struct {
	resp   *MessageType
	err    error
	deltas []string
}

func (m *mockProvider) Ask(chat *Chat) (*MessageType, error) {
	return m.resp, m.err
}

func (m *mockProvider) AskStream(chat *Chat, onDelta func(string)) (*MessageType, error) {
	for _, d := range m.deltas {
		if onDelta != nil {
			onDelta(d)
		}
	}
	return m.resp, m.err
}

func TestNew(t *testing.T) {
	mp := &mockProvider{}
	c := New(mp, "test-model")

	if c.Model != "test-model" {
		t.Errorf("expected model 'test-model', got '%s'", c.Model)
	}
	if len(c.Messages()) != 0 {
		t.Errorf("expected empty messages, got %d", len(c.Messages()))
	}
}

func TestAsk_AppendsHistory(t *testing.T) {
	mp := &mockProvider{
		resp: &MessageType{Role: RoleAssistant, Content: "hello back"},
	}
	c := New(mp, "test-model")

	c.Ask("hello")

	msgs := c.Messages()
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].Role != RoleUser || msgs[0].Content != "hello" {
		t.Errorf("unexpected user message: %+v", msgs[0])
	}
	if msgs[1].Role != RoleAssistant || msgs[1].Content != "hello back" {
		t.Errorf("unexpected assistant message: %+v", msgs[1])
	}
}

func TestAsk_ReturnsContent(t *testing.T) {
	mp := &mockProvider{
		resp: &MessageType{Role: RoleAssistant, Content: "response text"},
	}
	c := New(mp, "test-model")

	resp, err := c.Ask("prompt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != "response text" {
		t.Errorf("expected 'response text', got '%s'", resp)
	}
}

func TestAsk_ProviderError(t *testing.T) {
	mp := &mockProvider{
		err: fmt.Errorf("provider failure"),
	}
	c := New(mp, "test-model")

	_, err := c.Ask("prompt")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "provider failure" {
		t.Errorf("expected 'provider failure', got '%s'", err.Error())
	}
}

func TestAsk_MultipleConversations(t *testing.T) {
	mp := &mockProvider{}
	c := New(mp, "test-model")

	mp.resp = &MessageType{Role: RoleAssistant, Content: "first response"}
	c.Ask("first")

	mp.resp = &MessageType{Role: RoleAssistant, Content: "second response"}
	c.Ask("second")

	msgs := c.Messages()
	if len(msgs) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(msgs))
	}
	expected := []struct {
		role    RoleType
		content string
	}{
		{RoleUser, "first"},
		{RoleAssistant, "first response"},
		{RoleUser, "second"},
		{RoleAssistant, "second response"},
	}
	for i, e := range expected {
		if msgs[i].Role != e.role || msgs[i].Content != e.content {
			t.Errorf("msg %d: expected (%s, %s), got (%s, %s)",
				i, e.role, e.content, msgs[i].Role, msgs[i].Content)
		}
	}
}

func TestMessages(t *testing.T) {
	mp := &mockProvider{
		resp: &MessageType{Role: RoleAssistant, Content: "ok"},
	}
	c := New(mp, "test-model")
	c.Ask("hi")

	msgs := c.Messages()
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
}

func TestAskStream_ForwardsDeltasAndAppendsHistory(t *testing.T) {
	mp := &mockProvider{
		resp:   &MessageType{Role: RoleAssistant, Content: "hello back"},
		deltas: []string{"hello ", "back"},
	}
	c := New(mp, "test-model")

	var got []string
	resp, err := c.AskStream("hello", func(d string) { got = append(got, d) })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp != "hello back" {
		t.Errorf("expected 'hello back', got '%s'", resp)
	}
	if len(got) != 2 || got[0] != "hello " || got[1] != "back" {
		t.Errorf("unexpected deltas: %v", got)
	}

	msgs := c.Messages()
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].Role != RoleUser || msgs[0].Content != "hello" {
		t.Errorf("unexpected user message: %+v", msgs[0])
	}
	if msgs[1].Role != RoleAssistant || msgs[1].Content != "hello back" {
		t.Errorf("unexpected assistant message: %+v", msgs[1])
	}
}

func TestAskStream_ProviderError(t *testing.T) {
	mp := &mockProvider{
		err: fmt.Errorf("provider failure"),
	}
	c := New(mp, "test-model")

	_, err := c.AskStream("prompt", func(string) {})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "provider failure" {
		t.Errorf("expected 'provider failure', got '%s'", err.Error())
	}
}
