package chat

type RoleType string

const (
	RoleUser      RoleType = "user"
	RoleAssistant RoleType = "assistant"
)

type FunctionType struct {
	Name      string
	Arguments string
}

type ToolCallType struct {
	Index    uint
	ID       string
	Function FunctionType
}

type MessageType struct {
	Role      RoleType
	Content   string
	ToolCalls []ToolCallType
}
