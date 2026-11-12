import { describe, expect, it } from "vitest"
import {
  CliError,
  DEFAULT_AGENT,
  DEFAULT_PORT,
  parseArgs,
  USAGE,
  validateAgent,
} from "../../src/jujuba/args.js"

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof CliError ? error.message : String(error)
  }
  return "no error"
}

describe("parseArgs", () => {
  it("defaults to a local run", () => {
    expect(parseArgs([])).toEqual({
      command: "run",
      port: DEFAULT_PORT,
      agent: DEFAULT_AGENT,
      configFile: undefined,
      stateDir: undefined,
      force: false,
    })
  })

  it("accepts every subcommand", () => {
    for (const command of ["run", "start", "build", "init", "doctor"] as const) {
      expect(parseArgs([command]).command).toBe(command)
    }
  })

  it("handles help and version aliases", () => {
    for (const flag of ["-h", "--help"]) expect(parseArgs([flag]).command).toBe("help")
    for (const flag of ["-v", "--version"]) expect(parseArgs([flag]).command).toBe("version")
  })

  it("reads long options with a separate value", () => {
    const options = parseArgs([
      "--port",
      "9000",
      "--agent",
      "work",
      "--config",
      "/tmp/env",
      "--state",
      "/tmp/state",
      "--force",
    ])
    expect(options).toMatchObject({
      port: 9000,
      agent: "work",
      configFile: "/tmp/env",
      stateDir: "/tmp/state",
      force: true,
    })
  })

  it("reads long options with an inline value", () => {
    expect(parseArgs(["--port=9001", "--agent=peer", "--config=/c", "--state=/s"])).toMatchObject({
      port: 9001,
      agent: "peer",
      configFile: "/c",
      stateDir: "/s",
    })
  })

  it("lets defaults win over the built-in values", () => {
    expect(parseArgs([], { port: 9002, agent: "custom" })).toMatchObject({ port: 9002, agent: "custom" })
  })

  it("treats --no-build as start", () => {
    expect(parseArgs(["--no-build"]).command).toBe("start")
    expect(parseArgs(["start", "--no-build"]).command).toBe("start")
  })

  it("rejects a missing or empty option value", () => {
    expect(code(() => parseArgs(["--port"]))).toBe("--port needs a value")
    expect(code(() => parseArgs(["--port="]))).toBe("--port needs a value")
    expect(code(() => parseArgs(["--config="]))).toBe("--config needs a value")
    expect(code(() => parseArgs(["--agent"]))).toBe("--agent needs a value")
    expect(code(() => parseArgs(["--state"]))).toBe("--state needs a value")
  })

  it("rejects an invalid port", () => {
    for (const value of ["0", "65536", "1.5", "not-a-number"]) {
      expect(code(() => parseArgs(["--port", value]))).toBe(`invalid port: ${value}`)
    }
  })

  it("rejects unknown options and commands", () => {
    expect(code(() => parseArgs(["--wat"]))).toBe("unknown option: --wat")
    expect(code(() => parseArgs(["-x"]))).toBe("unknown option: -x")
    expect(code(() => parseArgs(["deploy"]))).toBe("unknown command: deploy")
  })

  it("rejects a second positional argument", () => {
    expect(code(() => parseArgs(["build", "extra"]))).toBe("unexpected argument: extra")
  })

  it("reports its own usage text", () => {
    expect(USAGE).toContain("jujuba doctor")
  })
})

describe("validateAgent", () => {
  it("accepts safe names and rejects the rest", () => {
    expect(validateAgent("tui")).toBe("tui")
    expect(() => validateAgent("bad name")).toThrow()
  })
})
