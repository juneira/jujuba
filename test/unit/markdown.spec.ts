import { describe, expect, it } from "vitest"
import { markdownLines } from "../../src/tui/markdown.js"

function text(source: string): string[] {
  return markdownLines(source).map((line) => line.segments.map((segment) => segment.text).join(""))
}

function styled(source: string): { text: string; style: string }[][] {
  return markdownLines(source).map((line) =>
    line.segments.map((segment) => ({ text: segment.text, style: segment.style })),
  )
}

describe("plain text", () => {
  it("keeps ordinary lines as assistant text", () => {
    expect(styled("hello\nworld")).toEqual([
      [{ text: "hello", style: "assistant" }],
      [{ text: "world", style: "assistant" }],
    ])
  })

  it("keeps blank lines", () => {
    expect(text("one\n\ntwo")).toEqual(["one", "", "two"])
  })

  it("renders empty input as one empty line", () => {
    expect(styled("")).toEqual([[{ text: "", style: "assistant" }]])
  })

  it("strips carriage returns", () => {
    expect(text("## Title\r\nbody\r")).toEqual(["Title", "body"])
  })
})

describe("headings", () => {
  it("conceals the marker and styles the title", () => {
    expect(styled("## Title")).toEqual([[{ text: "Title", style: "heading" }]])
  })

  it("drops a closing hash sequence", () => {
    expect(text("### Title ###")).toEqual(["Title"])
  })

  it("keeps an empty heading as an empty styled line", () => {
    expect(styled("# ")).toEqual([[{ text: "", style: "heading" }]])
  })

  it("styles inline markup inside a heading", () => {
    expect(styled("# **bold**")).toEqual([[{ text: "bold", style: "strong" }]])
  })
})

describe("emphasis", () => {
  it("conceals strong, emphasis and combined markers", () => {
    expect(styled("**bold**")).toEqual([[{ text: "bold", style: "strong" }]])
    expect(styled("*it*")).toEqual([[{ text: "it", style: "emphasis" }]])
    expect(styled("***both***")).toEqual([[{ text: "both", style: "strong-emphasis" }]])
    expect(styled("__strong__")).toEqual([[{ text: "strong", style: "strong" }]])
    expect(styled("_under_")).toEqual([[{ text: "under", style: "emphasis" }]])
  })

  it("conceals strikethrough markers", () => {
    expect(styled("~~gone~~")).toEqual([[{ text: "gone", style: "strike" }]])
  })

  it("nests emphasis inside strong", () => {
    expect(styled("**bold *it* bold**")).toEqual([
      [
        { text: "bold ", style: "strong" },
        { text: "it", style: "strong-emphasis" },
        { text: " bold", style: "strong" },
      ],
    ])
  })

  it("leaves intraword underscores alone", () => {
    expect(text("snake_case_name")).toEqual(["snake_case_name"])
  })

  it("does not close an underscore marker before a word", () => {
    expect(text("_em_x")).toEqual(["_em_x"])
  })

  it("closes an underscore marker before punctuation", () => {
    expect(styled("_em_!")).toEqual([
      [
        { text: "em", style: "emphasis" },
        { text: "!", style: "assistant" },
      ],
    ])
  })

  it("keeps unmatched markers literal", () => {
    expect(text("**open")).toEqual(["**open"])
    expect(text("_open")).toEqual(["_open"])
    expect(text("** bold**")).toEqual(["** bold**"])
  })

  it("keeps a lone tilde literal", () => {
    expect(text("a ~ b")).toEqual(["a ~ b"])
  })
})

describe("inline code", () => {
  it("conceals backticks and does not parse the span", () => {
    expect(styled("use `npm i` now")).toEqual([
      [
        { text: "use ", style: "assistant" },
        { text: "npm i", style: "inline-code" },
        { text: " now", style: "assistant" },
      ],
    ])
    expect(styled("`*x*`")).toEqual([[{ text: "*x*", style: "inline-code" }]])
  })

  it("supports multi-backtick spans", () => {
    expect(styled("``a`b``")).toEqual([[{ text: "a`b", style: "inline-code" }]])
  })

  it("keeps an unclosed backtick literal", () => {
    expect(text("unclosed `code")).toEqual(["unclosed `code"])
  })
})

describe("links", () => {
  it("shows the label and conceals the target", () => {
    expect(styled("see [docs](https://x.dev)")).toEqual([
      [
        { text: "see ", style: "assistant" },
        { text: "docs", style: "link" },
      ],
    ])
  })

  it("falls back to the target when the label is empty", () => {
    expect(styled("[](https://x.dev)")).toEqual([[{ text: "https://x.dev", style: "link" }]])
  })

  it("styles inline markup inside the label", () => {
    expect(styled("[**x**](u)")).toEqual([[{ text: "x", style: "strong" }]])
  })

  it("keeps malformed links literal", () => {
    expect(text("[broken](")).toEqual(["[broken]("])
    expect(text("[broken]x")).toEqual(["[broken]x"])
    expect(text("[broken")).toEqual(["[broken"])
    expect(text("[]()")).toEqual(["[]()"])
  })

  it("handles several links on one line", () => {
    expect(text("[a](b) and [c](d)")).toEqual(["a and c"])
  })
})

describe("escapes", () => {
  it("renders backslash escapes literally", () => {
    expect(styled("\\*not em\\*")).toEqual([[{ text: "*not em*", style: "assistant" }]])
  })

  it("keeps a trailing backslash", () => {
    expect(text("a\\")).toEqual(["a\\"])
  })
})

describe("lists", () => {
  it("replaces bullet markers and keeps indentation", () => {
    expect(styled("- one\n  * nested")).toEqual([
      [
        { text: "", style: "assistant" },
        { text: "• ", style: "list-marker" },
        { text: "one", style: "assistant" },
      ],
      [
        { text: "  ", style: "assistant" },
        { text: "• ", style: "list-marker" },
        { text: "nested", style: "assistant" },
      ],
    ])
  })

  it("keeps ordered list numbers and normalizes the delimiter", () => {
    expect(text("1. first\n2) second\n10. tenth")).toEqual(["1. first", "2. second", "10. tenth"])
  })
})

describe("quotes", () => {
  it("replaces the quote marker with a gutter", () => {
    expect(styled("> quote")).toEqual([
      [
        { text: "│ ", style: "quote" },
        { text: "quote", style: "quote" },
      ],
    ])
  })

  it("collapses nested quotes", () => {
    expect(text("> > nested")).toEqual(["│ nested"])
    expect(text(">")).toEqual(["│ "])
  })
})

describe("rules", () => {
  it("renders a fixed rule for each marker style", () => {
    expect(styled("---")).toEqual([[{ text: "────────────", style: "rule" }]])
    expect(text("* * *")).toEqual(["────────────"])
    expect(text("___")).toEqual(["────────────"])
  })

  it("does not confuse a bullet with a rule", () => {
    expect(text("- item")).toEqual(["• item"])
  })
})

describe("fenced code", () => {
  it("conceals the fences and labels the language", () => {
    expect(styled("```ts\nconst x = 1\n```")).toEqual([
      [
        { text: "│ ", style: "tool-meta" },
        { text: "ts", style: "code-lang" },
      ],
      [
        { text: "│ ", style: "tool-meta" },
        { text: "const x = 1", style: "code-block" },
      ],
    ])
  })

  it("renders an unlabeled fence without a label line", () => {
    expect(text("```\nplain\n```")).toEqual(["│ plain"])
  })

  it("supports tilde fences and longer closing fences", () => {
    expect(text("~~~\ncode\n~~~")).toEqual(["│ code"])
    expect(text("```\ncode\n`````")).toEqual(["│ code"])
  })

  it("keeps an unclosed fence as code to the end", () => {
    expect(text("```\nstill code")).toEqual(["│ still code"])
  })

  it("does not close on a different character, a shorter run or an info string", () => {
    expect(text("```\n~~~\n``")).toEqual(["│ ~~~", "│ ``"])
    expect(text("````\ncode\n```")).toEqual(["│ code", "│ ```"])
    expect(text("```\ncode\n```js")).toEqual(["│ code", "│ ```js"])
  })
})

describe("tables", () => {
  it("renders a bordered table", () => {
    const source = "| first_column | second_column|\n| --- | --- |\n| a | 1 |\n| longer value | 22 |"
    expect(text(source)).toEqual([
      "┌──────────────┬───────────────┐",
      "│ first_column │ second_column │",
      "├──────────────┼───────────────┤",
      "│ a            │ 1             │",
      "│ longer value │ 22            │",
      "└──────────────┴───────────────┘",
    ])
    expect(styled(source)[1]).toEqual([
      { text: "│ ", style: "table-border" },
      { text: "first_column", style: "table-header" },
      { text: " │ ", style: "table-border" },
      { text: "second_column", style: "table-header" },
      { text: " │", style: "table-border" },
    ])
  })

  it("accepts rows without outer pipes", () => {
    expect(text("a | b\n--- | ---\n1 | 2")).toEqual([
      "┌───┬───┐",
      "│ a │ b │",
      "├───┼───┤",
      "│ 1 │ 2 │",
      "└───┴───┘",
    ])
  })

  it("aligns columns from the delimiter row", () => {
    const source = "| left | center | right |\n| :--- | :----: | ----: |\n| x | y | z |"
    expect(text(source)).toEqual([
      "┌──────┬────────┬───────┐",
      "│ left │ center │ right │",
      "├──────┼────────┼───────┤",
      "│ x    │   y    │     z │",
      "└──────┴────────┴───────┘",
    ])
  })

  it("parses inline markup and escaped pipes inside cells", () => {
    const source = "| **b** | `c` |\n| --- | --- |\n| a \\| b | 1 |"
    expect(text(source)).toEqual([
      "┌───────┬───┐",
      "│ b     │ c │",
      "├───────┼───┤",
      "│ a | b │ 1 │",
      "└───────┴───┘",
    ])
    expect(styled(source)[1]?.[1]).toEqual({ text: "b", style: "strong" })
    expect(styled(source)[3]?.[1]).toEqual({ text: "a | b", style: "assistant" })
  })

  it("pads short rows and drops extra cells", () => {
    const source = "| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |"
    expect(text(source)).toEqual([
      "┌───┬───┐",
      "│ a │ b │",
      "├───┼───┤",
      "│ 1 │   │",
      "│ 1 │ 2 │",
      "└───┴───┘",
    ])
  })

  it("renders a header-only table without a separator", () => {
    expect(text("| only |\n| --- |")).toEqual(["┌──────┐", "│ only │", "└──────┘"])
  })

  it("measures wide and combining characters", () => {
    expect(text("| 名前 | e |\n| --- | --- |\n| 太郎 | 😀 |")).toEqual([
      "┌──────┬────┐",
      "│ 名前 │ e  │",
      "├──────┼────┤",
      "│ 太郎 │ 😀 │",
      "└──────┴────┘",
    ])
    expect(text("| e\u0301 | x |\n| --- | --- |\n| y | z |")).toEqual([
      "┌───┬───┐",
      "│ e\u0301 │ x │",
      "├───┼───┤",
      "│ y │ z │",
      "└───┴───┘",
    ])
  })

  it("truncates cells to the width budget", () => {
    const columns = 15
    const header = `| ${Array.from({ length: columns }, (_, index) => `c${index}`).join(" | ")} |`
    const delimiter = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`
    const body = `| ${Array.from({ length: columns }, () => "abcdef").join(" | ")} |`
    const lines = text([header, delimiter, body].join("\n"))
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe(`┌${Array.from({ length: columns }, () => "────").join("┬")}┐`)
    expect(lines[1]).toBe(
      `│ ${Array.from({ length: columns }, (_, index) => (index < 10 ? `c${index}` : "c…")).join(" │ ")} │`,
    )
    expect(lines[3]).toBe(`│ ${Array.from({ length: columns }, () => "a…").join(" │ ")} │`)
  })

  it("truncates to an ellipsis when the budget is exhausted", () => {
    const columns = 25
    const header = `| ${Array.from({ length: columns }, (_, index) => `h${index}`).join(" | ")} |`
    const delimiter = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`
    const body = `| ${Array.from({ length: columns }, () => "abcdef").join(" | ")} |`
    const lines = text([header, delimiter, body].join("\n"))
    expect(lines[0]).toBe(`┌${Array.from({ length: columns }, () => "───").join("┬")}┐`)
    expect(lines[1]).toBe(`│ ${Array.from({ length: columns }, () => "…").join(" │ ")} │`)
    expect(lines[3]).toBe(`│ ${Array.from({ length: columns }, () => "…").join(" │ ")} │`)
  })

  it("leaves malformed tables as text", () => {
    expect(text("| a | b |\n| --- |")).toEqual(["| a | b |", "| --- |"])
    expect(text("| a | b |\n| --x | --- |")).toEqual(["| a | b |", "| --x | --- |"])
    expect(text("a | b\n---")).toEqual(["a | b", "────────────"])
    expect(text("| a |")).toEqual(["| a |"])
  })

  it("stops a table at a blank line or a line without pipes", () => {
    const source = "| a |\n| --- |\n| 1 |\n\nafter"
    expect(text(source)).toEqual(["┌───┐", "│ a │", "├───┤", "│ 1 │", "└───┘", "", "after"])

    const interrupted = "| a |\n| --- |\n| 1 |\nnot a row\n\nafter"
    expect(text(interrupted)).toEqual([
      "┌───┐",
      "│ a │",
      "├───┤",
      "│ 1 │",
      "└───┘",
      "not a row",
      "",
      "after",
    ])
  })
})
