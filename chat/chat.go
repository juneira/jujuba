package chat

type Provider interface {
	Ask(chat *Chat) (*MessageType, error)
	AskStream(chat *Chat, onDelta func(string)) (*MessageType, error)
}

type Chat struct {
	provider Provider
	Model    string
	messages []MessageType
}

func New(provider Provider, model string) *Chat {
	return &Chat{
		provider: provider,
		Model:    model,
	}
}

func (c *Chat) Messages() []MessageType {
	return c.messages
}

func (c *Chat) Ask(message string) (string, error) {
	c.messages = append(c.messages, MessageType{
		Role:    RoleUser,
		Content: message,
	})

	resp, err := c.provider.Ask(c)
	if err != nil {
		return "", err
	}

	c.messages = append(c.messages, *resp)
	return resp.Content, nil
}

func (c *Chat) AskStream(message string, onDelta func(string)) (string, error) {
	c.messages = append(c.messages, MessageType{
		Role:    RoleUser,
		Content: message,
	})

	resp, err := c.provider.AskStream(c, onDelta)
	if err != nil {
		return "", err
	}

	c.messages = append(c.messages, *resp)
	return resp.Content, nil
}
