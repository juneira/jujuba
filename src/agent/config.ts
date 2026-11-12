import { SYSTEM_PROMPT } from "./prompt.js"

export const OPENROUTER_PROVIDER_ID = "openrouter"
export const CODING_AGENT_ID = "coder"

export interface AgentConfigInput {
  readonly apiKey: string
  /** OpenRouter model id, such as deepseek/deepseek-v4.1-flash-1017. */
  readonly model: string
  /** Override for tests and gateways. Omit to use https://openrouter.ai/api/v1. */
  readonly baseURL?: string
  readonly systemPrompt?: string
}

export interface AgentConfig {
  readonly model: string
  readonly default_agent: string
  readonly agents: Record<string, unknown>
  readonly providers: Record<string, unknown>
}

export function buildAgentConfig(input: AgentConfigInput): AgentConfig {
  if (input.apiKey.trim() === "") {
    throw new Error("OPENROUTER_API_KEY is required")
  }
  if (input.model.trim() === "") {
    throw new Error("OPENROUTER_MODEL is required")
  }
  const modelRef = `${OPENROUTER_PROVIDER_ID}/${input.model}`
  const settings: Record<string, unknown> = { apiKey: input.apiKey }
  if (input.baseURL !== undefined && input.baseURL !== "") {
    settings.baseURL = input.baseURL
  }

  return {
    model: modelRef,
    default_agent: CODING_AGENT_ID,
    agents: {
      [CODING_AGENT_ID]: {
        description: "A coding agent that writes and runs code in /workspace.",
        mode: "primary",
        model: modelRef,
        system: input.systemPrompt ?? SYSTEM_PROMPT,
      },
    },
    providers: {
      [OPENROUTER_PROVIDER_ID]: {
        name: "OpenRouter",
        package: "@opencode/ai/providers/openrouter",
        settings,
        models: {
          [input.model]: { name: input.model },
        },
      },
    },
  }
}
