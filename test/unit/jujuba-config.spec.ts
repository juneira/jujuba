import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  loadEnvFile,
  parseEnvFile,
  resolveEnv,
  resolvePaths,
  serializeEnv,
} from "../../src/jujuba/config.js"

const temporary: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jujuba-config-"))
  temporary.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("parseEnvFile", () => {
  it("reads plain, exported and commented lines", () => {
    const values = parseEnvFile(
      [
        "# a comment",
        "",
        "OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash-1017",
        "export SANDBOX_INSTANCE=standard-1",
        "SANDBOX_INTERNET = true ",
      ].join("\n"),
    )
    expect(values).toEqual({
      OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash-1017",
      SANDBOX_INSTANCE: "standard-1",
      SANDBOX_INTERNET: "true",
    })
  })

  it("ignores lines without a usable key", () => {
    const values = parseEnvFile(["=value", "NO_SEPARATOR", "1INVALID=value", " = "].join("\n"))
    expect(values).toEqual({})
  })

  it("strips an inline comment from an unquoted value", () => {
    expect(parseEnvFile("A=value # comment").A).toBe("value")
    expect(parseEnvFile("A=value#not-a-comment").A).toBe("value#not-a-comment")
  })

  it("keeps single-quoted values verbatim", () => {
    expect(parseEnvFile("A='a \\n b # c'").A).toBe("a \\n b # c")
  })

  it("unescapes double-quoted values", () => {
    expect(parseEnvFile('A="line\\n\\t\\r\\"\\\\end"').A).toBe('line\n\t\r"\\end')
  })

  it("leaves unknown escapes untouched inside double quotes", () => {
    expect(parseEnvFile('A="a\\qb"').A).toBe("a\\qb")
  })

  it("treats an unmatched quote as a plain value", () => {
    expect(parseEnvFile('A="unterminated').A).toBe('"unterminated')
  })

  it("produces an empty value for an empty assignment", () => {
    expect(parseEnvFile("A=").A).toBe("")
  })
})

describe("serializeEnv", () => {
  it("sorts keys and quotes values", () => {
    expect(serializeEnv({ B: "two", A: "one" })).toBe('A="one"\nB="two"\n')
  })

  it("escapes quotes, backslashes and control characters", () => {
    expect(serializeEnv({ A: 'a"b\\c\nd\re\tf' })).toBe('A="a\\"b\\\\c\\nd\\re\\tf"\n')
  })

  it("returns an empty string for an empty record", () => {
    expect(serializeEnv({})).toBe("")
  })

  it("round-trips through parseEnvFile", () => {
    const values = { OPENROUTER_API_KEY: "sk-or-v1-abc", OPENROUTER_MODEL: "a/b:c" }
    expect(parseEnvFile(serializeEnv(values))).toEqual(values)
  })
})

describe("loadEnvFile", () => {
  it("reads a file", () => {
    const file = path.join(tempDir(), "env")
    writeFileSync(file, "A=1\n")
    expect(loadEnvFile(file)).toEqual({ A: "1" })
  })

  it("returns an empty object when the file does not exist", () => {
    expect(loadEnvFile(path.join(tempDir(), "missing"))).toEqual({})
  })

  it("rethrows other read errors", () => {
    const dir = tempDir()
    expect(() => loadEnvFile(dir)).toThrow()
  })
})

describe("resolveEnv", () => {
  it("prefers the process environment over the config file", () => {
    const resolved = resolveEnv({
      file: { OPENROUTER_MODEL: "from-file", SANDBOX_INSTANCE: "lite" },
      env: { OPENROUTER_MODEL: "from-env", SANDBOX_INSTANCE: "" },
    })
    expect(resolved.values).toEqual({ OPENROUTER_MODEL: "from-env", SANDBOX_INSTANCE: "lite" })
    expect(resolved.droppedAuthToken).toBe(false)
  })

  it("skips keys that are absent everywhere", () => {
    expect(resolveEnv({ file: {}, env: {} }).values).toEqual({})
  })

  it("drops AUTH_TOKEN unless the caller allows it", () => {
    const dropped = resolveEnv({ file: { AUTH_TOKEN: "secret" }, env: {} })
    expect(dropped.values).toEqual({})
    expect(dropped.droppedAuthToken).toBe(true)

    const kept = resolveEnv({ file: { AUTH_TOKEN: "secret" }, env: {}, allowAuthToken: true })
    expect(kept.values).toEqual({ AUTH_TOKEN: "secret" })
    expect(kept.droppedAuthToken).toBe(false)
  })
})

describe("resolvePaths", () => {
  it("uses XDG directories and the jujuba names", () => {
    const paths = resolvePaths("/repo", {
      env: { HOME: "/home/a", XDG_CONFIG_HOME: "/cfg", XDG_STATE_HOME: "/state" },
    })
    expect(paths).toMatchObject({
      root: "/repo",
      configFile: path.join("/cfg", "jujuba", "env"),
      stateDir: path.join("/state", "jujuba"),
      runtimeEnvFile: path.join("/state", "jujuba", "env"),
      persistDir: path.join("/state", "jujuba", "wrangler-state"),
      bundleDir: path.join("/state", "jujuba", "dist"),
      buildStateFile: path.join("/state", "jujuba", "build.json"),
      tuiStateDir: path.join("/state", "jujuba", "tui"),
    })
  })

  it("falls back to the real home when nothing is configured", () => {
    const paths = resolvePaths("/repo")
    expect(paths.configFile.endsWith(path.join("jujuba", "env"))).toBe(true)
    expect(paths.stateDir.endsWith(path.join("state", "jujuba"))).toBe(true)
  })

  it("falls back to HOME and an explicit home option", () => {
    expect(resolvePaths("/repo", { env: { HOME: "/home/a" } }).configFile).toBe(
      path.join("/home/a", ".config", "jujuba", "env"),
    )
    expect(resolvePaths("/repo", { home: "/home/b" }).stateDir).toBe(
      path.join("/home/b", ".local", "state", "jujuba"),
    )
  })

  it("honours JUJUBA_CONFIG and JUJUBA_STATE", () => {
    const paths = resolvePaths("/repo", {
      env: { HOME: "/home/a", JUJUBA_CONFIG: "/tmp/cfg", JUJUBA_STATE: "/tmp/state" },
    })
    expect(paths.configFile).toBe("/tmp/cfg")
    expect(paths.stateDir).toBe("/tmp/state")
  })

  it("expands leading tildes and accepts explicit overrides", () => {
    expect(resolvePaths("/repo", { home: "/home/a", stateDir: "~" }).stateDir).toBe("/home/a")
    expect(resolvePaths("/repo", { home: "/home/a", stateDir: "~/s" }).stateDir).toBe("/home/a/s")
    expect(resolvePaths("/repo", { home: "/home/a", configFile: "/abs/env" }).configFile).toBe("/abs/env")
  })
})
