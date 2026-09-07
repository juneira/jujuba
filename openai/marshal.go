package openai

import (
	"encoding/json"
	"fmt"
)

func (s StopConfiguration) MarshalJSON() ([]byte, error) {
	if s.String != nil {
		return json.Marshal(*s.String)
	}
	if s.Array != nil {
		return json.Marshal(s.Array)
	}
	return []byte("null"), nil
}

func (c ChatCompletionRequestMessageContent) MarshalJSON() ([]byte, error) {
	if c.Text != nil {
		return json.Marshal(*c.Text)
	}
	if c.Parts != nil {
		return json.Marshal(c.Parts)
	}
	return []byte(`""`), nil
}

func (c *ChatCompletionRequestMessageContent) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty content")
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		c.Text = &s
		return nil
	}
	if data[0] == '[' {
		return json.Unmarshal(data, &c.Parts)
	}
	return fmt.Errorf("unexpected content type: %s", string(data))
}
