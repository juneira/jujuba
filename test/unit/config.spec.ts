import { describe, expect, it } from "vitest"
import { buildAgentConfig, CODING_AGENT_ID, OPENROUTER_PROVIDER_ID } from "../../src/agent/config.js"
import { SYSTEM_PROMPT } from "../../src/agent/prompt.js"

describe("SYSTEM_PROMPT", () => {
  it("names /workspace as the only root and rules out /bundle", () => {
    expect(SYSTEM_PROMPT).toContain("Your project root is /workspace")
    expect(SYSTEM_PROMPT).toContain("There is no /bundle")
    expect(SYSTEM_PROMPT).toContain("Do not look for /bundle")
    expect(SYSTEM_PROMPT).toContain("do not \"cd\" outside /workspace")
  })
})

describe("buildAgentConfig", () => {
  it("registers the OpenRouter provider and the coder agent", () => {
    const config = buildAgentConfig({ apiKey: "sk-test", model: "deepseek/deepseek-v4.1-flash-1017" })
    expect(config.model).toBe("openrouter/deepseek/deepseek-v4.1-flash-1017")
    expect(config.default_agent).toBe(CODING_AGENT_ID)

    const provider = config.providers[OPENROUTER_PROVIDER_ID] as {
      package: string
      settings: Record<string, unknown>
      models: Record<string, unknown>
    }
    expect(provider.package).toBe("@opencode/ai/providers/openrouter")
    expect(provider.settings).toEqual({ apiKey: "sk-test" })
    expect(provider.models).toEqual({ "deepseek/deepseek-v4.1-flash-1017": { name: "deepseek/deepseek-v4.1-flash-1017" } })

    const agent = config.agents[CODING_AGENT_ID] as { system: string; model: string; mode: string }
    expect(agent.system).toBe(SYSTEM_PROMPT)
    expect(agent.model).toBe(config.model)
    expect(agent.mode).toBe("primary")
  })

  it("passes a gateway base URL and a custom prompt", () => {
    const config = buildAgentConfig({
      apiKey: "sk-test",
      model: "openai/gpt-5",
      baseURL: "http://127.0.0.1:7432/v1",
      systemPrompt: "be terse",
    })
    const provider = config.providers[OPENROUTER_PROVIDER_ID] as { settings: Record<string, unknown> }
    expect(provider.settings).toEqual({ apiKey: "sk-test", baseURL: "http://127.0.0.1:7432/v1" })
    const agent = config.agents[CODING_AGENT_ID] as { system: string }
    expect(agent.system).toBe("be terse")
  })

  it("ignores an empty base URL", () => {
    const config = buildAgentConfig({ apiKey: "k", model: "m", baseURL: "" })
    const provider = config.providers[OPENROUTER_PROVIDER_ID] as { settings: Record<string, unknown> }
    expect(provider.settings).toEqual({ apiKey: "k" })
  })

  it("requires a key and a model", () => {
    expect(() => buildAgentConfig({ apiKey: " ", model: "m" })).toThrow(/OPENROUTER_API_KEY/)
    expect(() => buildAgentConfig({ apiKey: "k", model: " " })).toThrow(/OPENROUTER_MODEL/)
  })
})
