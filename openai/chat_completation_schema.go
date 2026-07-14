package openai

// This file contains Go types mirroring the OpenAPI schemas used by the
// /chat/completions* endpoints (text only), as defined in docs/openapi.yaml.
//
// Field names and JSON tags match the YAML property names. Nullable and
// optional fields use pointer types. Free-form objects (JSON Schema with
// additionalProperties) use `map[string]any`. `oneOf`/`anyOf` unions are
// modeled as small structs holding one populated pointer field (see
// `ChatCompletionToolChoiceOption`), NOT as `any`.

// =============================================================================
// Shared / metadata
// =============================================================================

// Metadata corresponds to the `Metadata` schema.
//
// Set of up to 16 key-value pairs attachable to an object. Keys are strings up
// to 64 chars; values are strings up to 512 chars.
type Metadata map[string]string

// ChatCompletionRole corresponds to the `ChatCompletionRole` schema.
type ChatCompletionRole string

const (
	ChatCompletionRoleDeveloper ChatCompletionRole = "developer"
	ChatCompletionRoleSystem    ChatCompletionRole = "system"
	ChatCompletionRoleUser      ChatCompletionRole = "user"
	ChatCompletionRoleAssistant ChatCompletionRole = "assistant"
	ChatCompletionRoleTool      ChatCompletionRole = "tool"
	ChatCompletionRoleFunction  ChatCompletionRole = "function"
)

// =============================================================================
// Common request properties (ModelResponseProperties / CreateModelResponseProperties)
// =============================================================================

// ModelResponseProperties corresponds to the `ModelResponseProperties` schema.
type ModelResponseProperties struct {
	Metadata             *Metadata  `json:"metadata,omitempty"`
	TopLogprobs          *int       `json:"top_logprobs,omitempty"`
	Temperature          *float64   `json:"temperature,omitempty"`
	TopP                 *float64   `json:"top_p,omitempty"`
	User                 *string    `json:"user,omitempty"`
	SafetyIdentifier     *string    `json:"safety_identifier,omitempty"`
	PromptCacheKey       *string    `json:"prompt_cache_key,omitempty"`
	ServiceTier          *string    `json:"service_tier,omitempty"` // ServiceTier
	PromptCacheRetention *string    `json:"prompt_cache_retention,omitempty"` // "in_memory" | "24h"
}

// CreateModelResponseProperties corresponds to the
// `CreateModelResponseProperties` schema (allOf: ModelResponseProperties + top_logprobs).
type CreateModelResponseProperties struct {
	ModelResponseProperties
	TopLogprobs *int `json:"top_logprobs,omitempty"`
}

// ModelIdsShared corresponds to the `ModelIdsShared` schema (a string or one of
// the known enum values). Modeled as a plain string.
type ModelIdsShared string

// Verbosity corresponds to the `Verbosity` schema: "low" | "medium" | "high".
type Verbosity string

const (
	VerbosityLow    Verbosity = "low"
	VerbosityMedium Verbosity = "medium"
	VerbosityHigh   Verbosity = "high"
)

// ReasoningEffort corresponds to the `ReasoningEffort` schema:
// "none" | "minimal" | "low" | "medium" | "high" | "xhigh".
type ReasoningEffort string

const (
	ReasoningEffortNone    ReasoningEffort = "none"
	ReasoningEffortMinimal ReasoningEffort = "minimal"
	ReasoningEffortLow     ReasoningEffort = "low"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
	ReasoningEffortXHigh   ReasoningEffort = "xhigh"
)

// ParallelToolCalls corresponds to the `ParallelToolCalls` schema.
type ParallelToolCalls bool

// StopConfiguration corresponds to the `StopConfiguration` schema: a string
// or an array of up to 4 strings. Exactly one of the fields is populated.
type StopConfiguration struct {
	String *string
	Array  []string
}

// ServiceTier corresponds to the `ServiceTier` schema:
// "auto" | "default" | "flex" | "scale" | "priority".
type ServiceTier string

const (
	ServiceTierAuto     ServiceTier = "auto"
	ServiceTierDefault  ServiceTier = "default"
	ServiceTierFlex     ServiceTier = "flex"
	ServiceTierScale    ServiceTier = "scale"
	ServiceTierPriority ServiceTier = "priority"
)

// ChatCompletionStreamOptions corresponds to the
// `ChatCompletionStreamOptions` schema.
type ChatCompletionStreamOptions struct {
	IncludeUsage       *bool `json:"include_usage,omitempty"`
	IncludeObfuscation *bool `json:"include_obfuscation,omitempty"`
}

// =============================================================================
// Web search (inline in CreateChatCompletionRequest)
// =============================================================================

// WebSearchContextSize corresponds to the `WebSearchContextSize` schema:
// "low" | "medium" | "high".
type WebSearchContextSize string

const (
	WebSearchContextSizeLow    WebSearchContextSize = "low"
	WebSearchContextSizeMedium WebSearchContextSize = "medium"
	WebSearchContextSizeHigh   WebSearchContextSize = "high"
)

// WebSearchLocation corresponds to the `WebSearchLocation` schema.
type WebSearchLocation struct {
	Country  *string `json:"country,omitempty"`
	Region   *string `json:"region,omitempty"`
	City     *string `json:"city,omitempty"`
	Timezone *string `json:"timezone,omitempty"`
}

// WebSearchUserLocation corresponds to the inline `user_location` object
// inside the request's `web_search_options`.
type WebSearchUserLocation struct {
	Type        string             `json:"type"` // always "approximate"
	Approximate *WebSearchLocation `json:"approximate"`
}

// WebSearchOptions corresponds to the inline `web_search_options` object in
// `CreateChatCompletionRequest`.
type WebSearchOptions struct {
	UserLocation      *WebSearchUserLocation `json:"user_location,omitempty"`
	SearchContextSize *WebSearchContextSize  `json:"search_context_size,omitempty"`
}

// =============================================================================
// Response format
// =============================================================================

// ResponseFormatText corresponds to the `ResponseFormatText` schema.
type ResponseFormatText struct {
	Type string `json:"type"` // always "text"
}

// ResponseFormatJsonObject corresponds to the `ResponseFormatJsonObject` schema.
type ResponseFormatJsonObject struct {
	Type string `json:"type"` // always "json_object"
}

// ResponseFormatJsonSchemaSchema corresponds to the
// `ResponseFormatJsonSchemaSchema` schema (free-form JSON Schema).
type ResponseFormatJsonSchemaSchema map[string]any

// ResponseFormatJsonSchema corresponds to the `ResponseFormatJsonSchema` schema.
type ResponseFormatJsonSchema struct {
	Type       string                        `json:"type"` // always "json_schema"
	JSONSchema ResponseFormatJsonSchemaInner `json:"json_schema"`
}

// ResponseFormatJsonSchemaInner is the inner `json_schema` object of
// `ResponseFormatJsonSchema`.
type ResponseFormatJsonSchemaInner struct {
	Description *string                        `json:"description,omitempty"`
	Name        string                         `json:"name"`
	Schema      ResponseFormatJsonSchemaSchema `json:"schema,omitempty"`
	Strict      *bool                          `json:"strict,omitempty"`
}

// ResponseFormat corresponds to the `response_format` oneOf in
// `CreateChatCompletionRequest`. Exactly one of the fields is populated.
type ResponseFormat struct {
	Text       *ResponseFormatText
	JSONObject *ResponseFormatJsonObject
	JSONSchema *ResponseFormatJsonSchema
}

// =============================================================================
// Prediction
// =============================================================================

// PredictionContent corresponds to the `PredictionContent` schema.
type PredictionContent struct {
	Type    string                              `json:"type"` // always "content"
	Content ChatCompletionRequestMessageContent `json:"content"`
}

// =============================================================================
// Custom tool
// =============================================================================

// CustomToolChatCompletions corresponds to the `CustomToolChatCompletions`
// schema.
type CustomToolChatCompletions struct {
	Type   string                            `json:"type"` // always "custom"
	Custom CustomToolChatCompletionsCustom   `json:"custom"`
}

// CustomToolChatCompletionsCustom is the inner `custom` object of
// `CustomToolChatCompletions`.
type CustomToolChatCompletionsCustom struct {
	Name        string             `json:"name"`
	Description *string            `json:"description,omitempty"`
	Format      *CustomToolFormat  `json:"format,omitempty"`
}

// CustomToolFormatText corresponds to the "Text format" branch of the inline
// `format` oneOf of `CustomToolChatCompletionsCustom`.
type CustomToolFormatText struct {
	Type string `json:"type"` // always "text"
}

// CustomToolFormatGrammar corresponds to the "Grammar format" branch of the
// inline `format` oneOf of `CustomToolChatCompletionsCustom`.
type CustomToolFormatGrammar struct {
	Type    string                        `json:"type"` // always "grammar"
	Grammar CustomToolFormatGrammarInner `json:"grammar"`
}

// CustomToolFormatGrammarInner is the inner `grammar` object of
// `CustomToolFormatGrammar`.
type CustomToolFormatGrammarInner struct {
	Definition string `json:"definition"`
	Syntax     string `json:"syntax"` // "lark" | "regex"
}

// CustomToolFormat corresponds to the inline `format` oneOf of
// `CustomToolChatCompletionsCustom` ("text" | "grammar"). Exactly one of the
// fields is populated.
type CustomToolFormat struct {
	Text    *CustomToolFormatText
	Grammar *CustomToolFormatGrammar
}

// =============================================================================
// Tool choice / tools
// =============================================================================

// ChatCompletionAllowedTools corresponds to the `ChatCompletionAllowedTools`
// schema.
type ChatCompletionAllowedTools struct {
	Mode  string              `json:"mode"`  // "auto" | "required"
	Tools []map[string]any    `json:"tools"` // free-form tool definitions
}

// ChatCompletionAllowedToolsChoice corresponds to the
// `ChatCompletionAllowedToolsChoice` schema.
type ChatCompletionAllowedToolsChoice struct {
	Type         string                     `json:"type"` // always "allowed_tools"
	AllowedTools ChatCompletionAllowedTools `json:"allowed_tools"`
}

// ChatCompletionNamedToolChoice corresponds to the
// `ChatCompletionNamedToolChoice` schema.
type ChatCompletionNamedToolChoice struct {
	Type     string                                 `json:"type"` // always "function"
	Function ChatCompletionNamedToolChoiceFunction `json:"function"`
}

// ChatCompletionNamedToolChoiceFunction is the inner `function` object of
// `ChatCompletionNamedToolChoice`.
type ChatCompletionNamedToolChoiceFunction struct {
	Name string `json:"name"`
}

// ChatCompletionNamedToolChoiceCustom corresponds to the
// `ChatCompletionNamedToolChoiceCustom` schema.
type ChatCompletionNamedToolChoiceCustom struct {
	Type   string                                    `json:"type"` // always "custom"
	Custom ChatCompletionNamedToolChoiceCustomInner `json:"custom"`
}

// ChatCompletionNamedToolChoiceCustomInner is the inner `custom` object of
// `ChatCompletionNamedToolChoiceCustom`.
type ChatCompletionNamedToolChoiceCustomInner struct {
	Name string `json:"name"`
}

// ChatCompletionToolChoiceOption corresponds to the
// `ChatCompletionToolChoiceOption` schema: a string mode
// ("none"|"auto"|"required") or one of the structured choices.
type ChatCompletionToolChoiceOption struct {
	// String mode (one of "none", "auto", "required"), or one of the structured
	// choices below. Exactly one of the pointers below will be populated.
	Mode         *string
	AllowedTools *ChatCompletionAllowedToolsChoice
	Function     *ChatCompletionNamedToolChoice
	Custom       *ChatCompletionNamedToolChoiceCustom
}

// ChatCompletionTool corresponds to the `ChatCompletionTool` schema.
type ChatCompletionTool struct {
	Type     string         `json:"type"` // always "function"
	Function FunctionObject `json:"function"`
}

// FunctionObject corresponds to the `FunctionObject` schema.
type FunctionObject struct {
	Description *string            `json:"description,omitempty"`
	Name        string             `json:"name"`
	Parameters  *FunctionParameters `json:"parameters,omitempty"`
	Strict      *bool              `json:"strict,omitempty"`
}

// FunctionParameters corresponds to the `FunctionParameters` schema: a free-form
// JSON Schema object describing the function's parameters.
type FunctionParameters map[string]any

// ChatCompletionFunctionCallOption corresponds to the
// `ChatCompletionFunctionCallOption` schema (deprecated).
type ChatCompletionFunctionCallOption struct {
	Name string `json:"name"`
}

// ChatCompletionFunctions corresponds to the `ChatCompletionFunctions` schema
// (deprecated).
type ChatCompletionFunctions struct {
	Description *string            `json:"description,omitempty"`
	Name        string             `json:"name"`
	Parameters  *FunctionParameters `json:"parameters,omitempty"`
}

// =============================================================================
// Tool calls (response side, oneOf in array)
// =============================================================================

// ChatCompletionMessageToolCall corresponds to the
// `ChatCompletionMessageToolCall` schema (function tool call).
type ChatCompletionMessageToolCall struct {
	ID       string                                 `json:"id"`
	Type     string                                 `json:"type"` // always "function"
	Function ChatCompletionMessageToolCallFunction `json:"function"`
}

// ChatCompletionMessageToolCallFunction is the inner `function` object of
// `ChatCompletionMessageToolCall`.
type ChatCompletionMessageToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ChatCompletionMessageCustomToolCall corresponds to the
// `ChatCompletionMessageCustomToolCall` schema (custom tool call).
type ChatCompletionMessageCustomToolCall struct {
	ID     string                                     `json:"id"`
	Type   string                                     `json:"type"` // always "custom"
	Custom ChatCompletionMessageCustomToolCallInner `json:"custom"`
}

// ChatCompletionMessageCustomToolCallInner is the inner `custom` object of
// `ChatCompletionMessageCustomToolCall`.
type ChatCompletionMessageCustomToolCallInner struct {
	Name  string `json:"name"`
	Input string `json:"input"`
}

// ChatCompletionMessageToolCallItem is one element of
// `ChatCompletionMessageToolCalls`: a function tool call or a custom tool call.
// Exactly one of the fields is populated.
type ChatCompletionMessageToolCallItem struct {
	Function *ChatCompletionMessageToolCall
	Custom   *ChatCompletionMessageCustomToolCall
}

// ChatCompletionMessageToolCalls corresponds to the
// `ChatCompletionMessageToolCalls` schema: an array where each item is a
// `ChatCompletionMessageToolCall` or `ChatCompletionMessageCustomToolCall`.
type ChatCompletionMessageToolCalls []ChatCompletionMessageToolCallItem

// ChatCompletionMessageToolCallChunk corresponds to the
// `ChatCompletionMessageToolCallChunk` schema (streamed tool call delta).
type ChatCompletionMessageToolCallChunk struct {
	Index    int                                          `json:"index"`
	ID       string                                       `json:"id,omitempty"`
	Type     string                                       `json:"type,omitempty"` // always "function"
	Function *ChatCompletionMessageToolCallChunkFunction `json:"function,omitempty"`
}

// ChatCompletionMessageToolCallChunkFunction is the inner `function` object of
// `ChatCompletionMessageToolCallChunk`.
type ChatCompletionMessageToolCallChunkFunction struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// =============================================================================
// Request: content parts
// =============================================================================

// ChatCompletionRequestMessageContentPartText corresponds to the
// `ChatCompletionRequestMessageContentPartText` schema.
type ChatCompletionRequestMessageContentPartText struct {
	Type string `json:"type"` // always "text"
	Text string `json:"text"`
}

// ChatCompletionRequestMessageContentPartRefusal corresponds to the
// `ChatCompletionRequestMessageContentPartRefusal` schema.
type ChatCompletionRequestMessageContentPartRefusal struct {
	Type    string `json:"type"` // always "refusal"
	Refusal string `json:"refusal"`
}

// ChatCompletionRequestAssistantMessageContentPart corresponds to the
// `ChatCompletionRequestAssistantMessageContentPart` oneOf: a text or refusal
// part. Exactly one of the fields is populated.
type ChatCompletionRequestAssistantMessageContentPart struct {
	Text    *ChatCompletionRequestMessageContentPartText
	Refusal *ChatCompletionRequestMessageContentPartRefusal
}

// ChatCompletionRequestSystemMessageContentPart corresponds to the
// `ChatCompletionRequestSystemMessageContentPart` schema: a text content part.
type ChatCompletionRequestSystemMessageContentPart = ChatCompletionRequestMessageContentPartText

// ChatCompletionRequestToolMessageContentPart corresponds to the
// `ChatCompletionRequestToolMessageContentPart` schema: a text content part.
type ChatCompletionRequestToolMessageContentPart = ChatCompletionRequestMessageContentPartText

// ChatCompletionRequestMessageContent corresponds to the oneOf used for the
// `content` field of developer/system/user/tool messages (and
// `PredictionContent.content`):
// string | []ChatCompletionRequestMessageContentPartText.
// Exactly one of the fields is populated.
type ChatCompletionRequestMessageContent struct {
	Text  *string
	Parts []ChatCompletionRequestMessageContentPartText
}

// ChatCompletionRequestAssistantMessageContent corresponds to the oneOf used for
// the `content` field of assistant messages:
// string | []ChatCompletionRequestAssistantMessageContentPart.
// Exactly one of the fields is populated.
type ChatCompletionRequestAssistantMessageContent struct {
	Text  *string
	Parts []ChatCompletionRequestAssistantMessageContentPart
}

// =============================================================================
// Request: messages
// =============================================================================

// ChatCompletionRequestAssistantMessageFunctionCall is the inline
// `function_call` object on `ChatCompletionRequestAssistantMessage`
// (deprecated).
type ChatCompletionRequestAssistantMessageFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ChatCompletionRequestDeveloperMessage corresponds to the
// `ChatCompletionRequestDeveloperMessage` schema.
type ChatCompletionRequestDeveloperMessage struct {
	Content ChatCompletionRequestMessageContent `json:"content"`
	Role    string                              `json:"role"` // always "developer"
	Name    *string                             `json:"name,omitempty"`
}

// ChatCompletionRequestSystemMessage corresponds to the
// `ChatCompletionRequestSystemMessage` schema.
type ChatCompletionRequestSystemMessage struct {
	Content ChatCompletionRequestMessageContent `json:"content"`
	Role    string                              `json:"role"` // always "system"
	Name    *string                             `json:"name,omitempty"`
}

// ChatCompletionRequestUserMessage corresponds to the
// `ChatCompletionRequestUserMessage` schema (text only).
type ChatCompletionRequestUserMessage struct {
	Content ChatCompletionRequestMessageContent `json:"content"`
	Role    string                              `json:"role"` // always "user"
	Name    *string                             `json:"name,omitempty"`
}

// ChatCompletionRequestAssistantMessage corresponds to the
// `ChatCompletionRequestAssistantMessage` schema (text only).
type ChatCompletionRequestAssistantMessage struct {
	Content      ChatCompletionRequestAssistantMessageContent           `json:"content,omitempty"`
	Refusal      *string                                               `json:"refusal,omitempty"`
	Role         string                                               `json:"role"` // always "assistant"
	Name         *string                                               `json:"name,omitempty"`
	ToolCalls    *ChatCompletionMessageToolCalls                       `json:"tool_calls,omitempty"`
	FunctionCall *ChatCompletionRequestAssistantMessageFunctionCall    `json:"function_call,omitempty"`
}

// ChatCompletionRequestToolMessage corresponds to the
// `ChatCompletionRequestToolMessage` schema.
type ChatCompletionRequestToolMessage struct {
	Role       string                              `json:"role"` // always "tool"
	Content    ChatCompletionRequestMessageContent `json:"content"`
	ToolCallID string                              `json:"tool_call_id"`
}

// ChatCompletionRequestFunctionMessage corresponds to the
// `ChatCompletionRequestFunctionMessage` schema (deprecated).
type ChatCompletionRequestFunctionMessage struct {
	Role    string  `json:"role"` // always "function"
	Content *string `json:"content"`
	Name    string  `json:"name"`
}

// ChatCompletionRequestMessage corresponds to the
// `ChatCompletionRequestMessage` oneOf schema (text only): a developer, system,
// user, assistant, tool or function message. Use the concrete types above for
// type-safe construction; this struct is provided for general use and
// JSON (un)marshalling.
type ChatCompletionRequestMessage struct {
	Role         string                                                `json:"role"`
	Content      ChatCompletionRequestMessageContent                   `json:"content,omitempty"`
	Name         *string                                               `json:"name,omitempty"`
	Refusal      *string                                               `json:"refusal,omitempty"`
	ToolCalls    *ChatCompletionMessageToolCalls                       `json:"tool_calls,omitempty"`
	FunctionCall *ChatCompletionRequestAssistantMessageFunctionCall    `json:"function_call,omitempty"`
	ToolCallID   *string                                               `json:"tool_call_id,omitempty"`
}

// =============================================================================
// Request body: CreateChatCompletionRequest
// =============================================================================

// ChatCompletionToolItem is one element of the request `tools` array: a
// function tool or a custom tool. Exactly one of the fields is populated.
type ChatCompletionToolItem struct {
	Function *ChatCompletionTool
	Custom   *CustomToolChatCompletions
}

// ChatCompletionFunctionCall corresponds to the deprecated `function_call`
// oneOf on `CreateChatCompletionRequest`: a string mode ("none"|"auto") or a
// `ChatCompletionFunctionCallOption`. Exactly one of the fields is populated.
type ChatCompletionFunctionCall struct {
	Mode   *string // "none" | "auto"
	Option *ChatCompletionFunctionCallOption
}

// CreateChatCompletionRequest corresponds to the
// `CreateChatCompletionRequest` schema (allOf: CreateModelResponseProperties).
type CreateChatCompletionRequest struct {
	CreateModelResponseProperties

	Messages            []ChatCompletionRequestMessage  `json:"messages"`
	Model               ModelIdsShared                  `json:"model"`
	Verbosity           *Verbosity                      `json:"verbosity,omitempty"`
	ReasoningEffort     *ReasoningEffort                `json:"reasoning_effort,omitempty"`
	MaxCompletionTokens *int                            `json:"max_completion_tokens,omitempty"`
	FrequencyPenalty    *float64                        `json:"frequency_penalty,omitempty"`
	PresencePenalty     *float64                        `json:"presence_penalty,omitempty"`
	WebSearchOptions    *WebSearchOptions               `json:"web_search_options,omitempty"`
	TopLogprobs         *int                            `json:"top_logprobs,omitempty"`
	ResponseFormat      ResponseFormat                  `json:"response_format,omitempty"`
	Store               *bool                           `json:"store,omitempty"`
	Stream              *bool                           `json:"stream,omitempty"`
	Stop                StopConfiguration               `json:"stop,omitempty"`
	LogitBias           map[string]int                  `json:"logit_bias,omitempty"`
	Logprobs            *bool                           `json:"logprobs,omitempty"`
	MaxTokens           *int                            `json:"max_tokens,omitempty"`
	N                   *int                            `json:"n,omitempty"`
	Prediction          *PredictionContent              `json:"prediction,omitempty"`
	Seed                *int                            `json:"seed,omitempty"`
	StreamOptions       *ChatCompletionStreamOptions    `json:"stream_options,omitempty"`
	Tools               []ChatCompletionToolItem        `json:"tools,omitempty"`
	ToolChoice          *ChatCompletionToolChoiceOption `json:"tool_choice,omitempty"`
	ParallelToolCalls   *ParallelToolCalls              `json:"parallel_tool_calls,omitempty"`
	FunctionCall        *ChatCompletionFunctionCall     `json:"function_call,omitempty"`
	Functions           []ChatCompletionFunctions       `json:"functions,omitempty"`
}

// =============================================================================
// Response: usage / logprobs / finish reason
// =============================================================================

// CompletionUsage corresponds to the `CompletionUsage` schema.
type CompletionUsage struct {
	CompletionTokens        int                                   `json:"completion_tokens"`
	PromptTokens            int                                   `json:"prompt_tokens"`
	TotalTokens             int                                   `json:"total_tokens"`
	CompletionTokensDetails *CompletionUsageCompletionTokensDetails `json:"completion_tokens_details,omitempty"`
	PromptTokensDetails     *CompletionUsagePromptTokensDetails     `json:"prompt_tokens_details,omitempty"`
}

// CompletionUsageCompletionTokensDetails is the inner
// `completion_tokens_details` object of `CompletionUsage`.
type CompletionUsageCompletionTokensDetails struct {
	AcceptedPredictionTokens int `json:"accepted_prediction_tokens"`
	AudioTokens              int `json:"audio_tokens"`
	ReasoningTokens          int `json:"reasoning_tokens"`
	RejectedPredictionTokens int `json:"rejected_prediction_tokens"`
}

// CompletionUsagePromptTokensDetails is the inner `prompt_tokens_details`
// object of `CompletionUsage`.
type CompletionUsagePromptTokensDetails struct {
	AudioTokens  int `json:"audio_tokens"`
	CachedTokens int `json:"cached_tokens"`
}

// ChatCompletionTokenLogprob corresponds to the
// `ChatCompletionTokenLogprob` schema.
type ChatCompletionTokenLogprob struct {
	Token       string                                   `json:"token"`
	Logprob     float64                                  `json:"logprob"`
	Bytes       []int                                    `json:"bytes"`
	TopLogprobs []ChatCompletionTokenLogprobTopLogprob   `json:"top_logprobs"`
}

// ChatCompletionTokenLogprobTopLogprob is an item in
// `ChatCompletionTokenLogprob.TopLogprobs`.
type ChatCompletionTokenLogprobTopLogprob struct {
	Token   string  `json:"token"`
	Logprob float64 `json:"logprob"`
	Bytes   []int   `json:"bytes"`
}

// ChatCompletionChoiceLogprobs is the inner `logprobs` object on
// `CreateChatCompletionResponse.choices[].logprobs`.
type ChatCompletionChoiceLogprobs struct {
	Content []ChatCompletionTokenLogprob `json:"content"`
	Refusal []ChatCompletionTokenLogprob `json:"refusal"`
}

// ChatCompletionResponseMessageAnnotation is the inline `annotations[]` item
// on `ChatCompletionResponseMessage` (a URL citation from web search).
type ChatCompletionResponseMessageAnnotation struct {
	Type        string                                                   `json:"type"` // always "url_citation"
	URLCitation ChatCompletionResponseMessageAnnotationURLCitation `json:"url_citation"`
}

// ChatCompletionResponseMessageAnnotationURLCitation is the inner
// `url_citation` object on a response message annotation.
type ChatCompletionResponseMessageAnnotationURLCitation struct {
	EndIndex   int    `json:"end_index"`
	StartIndex int    `json:"start_index"`
	URL        string `json:"url"`
	Title      string `json:"title"`
}

// ChatCompletionResponseMessageFunctionCall is the inline `function_call`
// object on `ChatCompletionResponseMessage` (deprecated).
type ChatCompletionResponseMessageFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ChatCompletionResponseMessage corresponds to the
// `ChatCompletionResponseMessage` schema (text only).
type ChatCompletionResponseMessage struct {
	Content      *string                                     `json:"content"`
	Refusal      *string                                     `json:"refusal"`
	ToolCalls    *ChatCompletionMessageToolCalls             `json:"tool_calls,omitempty"`
	Annotations  []ChatCompletionResponseMessageAnnotation   `json:"annotations,omitempty"`
	Role         string                                      `json:"role"` // always "assistant"
	FunctionCall *ChatCompletionResponseMessageFunctionCall  `json:"function_call,omitempty"`
}

// ChatCompletionChoice corresponds to the inline `choices[]` item on
// `CreateChatCompletionResponse`.
type ChatCompletionChoice struct {
	FinishReason string                        `json:"finish_reason"` // "stop"|"length"|"tool_calls"|"content_filter"|"function_call"
	Index        int                           `json:"index"`
	Message      ChatCompletionResponseMessage `json:"message"`
	Logprobs     *ChatCompletionChoiceLogprobs `json:"logprobs"`
}

// =============================================================================
// Response: CreateChatCompletionResponse
// =============================================================================

// CreateChatCompletionResponse corresponds to the
// `CreateChatCompletionResponse` schema.
type CreateChatCompletionResponse struct {
	ID                string                 `json:"id"`
	Choices           []ChatCompletionChoice `json:"choices"`
	Created           int64                  `json:"created"`
	Model             string                 `json:"model"`
	ServiceTier       *ServiceTier           `json:"service_tier,omitempty"`
	SystemFingerprint *string                `json:"system_fingerprint,omitempty"`
	Object            string                 `json:"object"` // always "chat.completion"
	Usage             *CompletionUsage       `json:"usage,omitempty"`
}

// =============================================================================
// Response: streaming
// =============================================================================

// ChatCompletionStreamResponseDelta corresponds to the
// `ChatCompletionStreamResponseDelta` schema (text only).
type ChatCompletionStreamResponseDelta struct {
	Content      *string                                     `json:"content,omitempty"`
	FunctionCall *ChatCompletionResponseMessageFunctionCall  `json:"function_call,omitempty"`
	ToolCalls    []ChatCompletionMessageToolCallChunk        `json:"tool_calls,omitempty"`
	Role         *ChatCompletionRole                        `json:"role,omitempty"`
	Refusal      *string                                    `json:"refusal,omitempty"`
}

// ChatCompletionStreamChoiceLogprobs is the inner `logprobs` object on a
// streamed choice.
type ChatCompletionStreamChoiceLogprobs struct {
	Content []ChatCompletionTokenLogprob `json:"content"`
	Refusal []ChatCompletionTokenLogprob `json:"refusal"`
}

// ChatCompletionStreamChoice corresponds to the inline `choices[]` item on
// `CreateChatCompletionStreamResponse`.
type ChatCompletionStreamChoice struct {
	Delta        ChatCompletionStreamResponseDelta   `json:"delta"`
	Logprobs     *ChatCompletionStreamChoiceLogprobs `json:"logprobs,omitempty"`
	FinishReason *string                             `json:"finish_reason"` // "stop"|"length"|"tool_calls"|"content_filter"|"function_call"
	Index        int                                 `json:"index"`
}

// CreateChatCompletionStreamResponse corresponds to the
// `CreateChatCompletionStreamResponse` schema.
type CreateChatCompletionStreamResponse struct {
	ID                string                       `json:"id"`
	Choices           []ChatCompletionStreamChoice `json:"choices"`
	Created           int64                        `json:"created"`
	Model             string                       `json:"model"`
	ServiceTier       *ServiceTier                 `json:"service_tier,omitempty"`
	SystemFingerprint *string                      `json:"system_fingerprint,omitempty"`
	Object            string                       `json:"object"` // always "chat.completion.chunk"
	Usage             *CompletionUsage             `json:"usage,omitempty"`
}

// =============================================================================
// Stored completion endpoints
// =============================================================================

// ChatCompletionDeleted corresponds to the `ChatCompletionDeleted` schema
// (returned by DELETE /chat/completions/{completion_id}).
type ChatCompletionDeleted struct {
	Object  string `json:"object"` // always "chat.completion.deleted"
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// ChatCompletionList corresponds to the `ChatCompletionList` schema
// (returned by GET /chat/completions).
type ChatCompletionList struct {
	Object  string                        `json:"object"` // always "list"
	Data    []CreateChatCompletionResponse `json:"data"`
	FirstID string                        `json:"first_id"`
	LastID  string                        `json:"last_id"`
	HasMore bool                          `json:"has_more"`
}

// ChatCompletionMessageListItem corresponds to an item in
// `ChatCompletionMessageList.data[]` (allOf: ChatCompletionResponseMessage
// with an extra `id` and optional `content_parts`).
type ChatCompletionMessageListItem struct {
	ChatCompletionResponseMessage
	ID           string                                              `json:"id"`
	ContentParts *[]ChatCompletionRequestMessageContentPartText      `json:"content_parts,omitempty"` // text parts; image_url parts not modeled in this text-only subset
}

// ChatCompletionMessageList corresponds to the `ChatCompletionMessageList`
// schema (returned by GET /chat/completions/{completion_id}/messages).
type ChatCompletionMessageList struct {
	Object  string                         `json:"object"` // always "list"
	Data    []ChatCompletionMessageListItem `json:"data"`
	FirstID string                         `json:"first_id"`
	LastID  string                         `json:"last_id"`
	HasMore bool                           `json:"has_more"`
}
