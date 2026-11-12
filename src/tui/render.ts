import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core"
import { displayRemote } from "../projects/registry.js"
import type { TuiCommandInfo } from "./commands.js"
import { gumSegments, gumWidth, TICK_FPS, type GumStyle } from "./gum.js"
import { viewLines, type ViewLine, type ViewSegment, type ViewStyle } from "./transcript.js"
import { headerDetails, statusLine, type TuiState } from "./view-model.js"

export interface SessionChoice {
  readonly id: string
  readonly title?: string
  readonly busy: boolean
  readonly project?: string
  readonly agent?: string
}

export interface ProjectChoice {
  readonly name: string
  readonly agent: string
  readonly remote?: string
}

const COLORS: Partial<Record<ViewStyle, RGBA>> = {
  user: RGBA.fromHex("#61afef"),
  "tool-name": RGBA.fromHex("#56b6c2"),
  "file-header": RGBA.fromHex("#c678dd"),
  "diff-added": RGBA.fromHex("#98c379"),
  "diff-removed": RGBA.fromHex("#e06c75"),
  "diff-hunk": RGBA.fromHex("#61afef"),
  error: RGBA.fromHex("#e06c75"),
  heading: RGBA.fromHex("#e5c07b"),
  "inline-code": RGBA.fromHex("#98c379"),
  link: RGBA.fromHex("#61afef"),
  quote: RGBA.fromHex("#7f848e"),
  "list-marker": RGBA.fromHex("#56b6c2"),
  rule: RGBA.fromHex("#7f848e"),
  "code-block": RGBA.fromHex("#c8ccd4"),
  "table-border": RGBA.fromHex("#7f848e"),
}

const ATTRIBUTES: Partial<Record<ViewStyle, number>> = {
  user: TextAttributes.BOLD,
  "tool-name": TextAttributes.BOLD,
  "file-header": TextAttributes.BOLD,
  error: TextAttributes.BOLD,
  "tool-args": TextAttributes.DIM,
  "tool-meta": TextAttributes.DIM,
  "diff-hunk": TextAttributes.DIM,
  output: TextAttributes.DIM,
  info: TextAttributes.DIM,
  heading: TextAttributes.BOLD,
  strong: TextAttributes.BOLD,
  emphasis: TextAttributes.ITALIC,
  "strong-emphasis": TextAttributes.BOLD | TextAttributes.ITALIC,
  strike: TextAttributes.STRIKETHROUGH | TextAttributes.DIM,
  link: TextAttributes.UNDERLINE,
  quote: TextAttributes.DIM,
  rule: TextAttributes.DIM,
  "code-lang": TextAttributes.DIM,
  "table-header": TextAttributes.BOLD,
}

function styledChunk(segment: ViewSegment): TextChunk {
  const color = COLORS[segment.style]
  const attributes = ATTRIBUTES[segment.style]
  return {
    __isChunk: true,
    text: segment.text,
    ...(color === undefined ? {} : { fg: color }),
    ...(attributes === undefined ? {} : { attributes }),
  }
}

/** Bubblegum pinks: the brand, the highlighted syllable and the ball. */
const GUM_COLORS: Record<GumStyle, RGBA> = {
  brand: RGBA.fromHex("#ff79c6"),
  active: RGBA.fromHex("#ff2d95"),
  ball: RGBA.fromHex("#ff8fd0"),
}

/** One line, clipped with an ellipsis so it never runs into the brand. */
function fitInfo(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

function brandContent(elapsedMs: number): StyledText {
  const chunks: TextChunk[] = gumSegments(elapsedMs).map((segment) => ({
    __isChunk: true,
    text: segment.text,
    fg: GUM_COLORS[segment.style],
    ...(segment.style === "active" ? { attributes: TextAttributes.BOLD } : {}),
  }))
  return new StyledText(chunks)
}

function transcriptContent(lines: readonly ViewLine[]): StyledText {
  const chunks: TextChunk[] = []
  lines.forEach((line, index) => {
    for (const segment of line.segments) chunks.push(styledChunk(segment))
    if (index < lines.length - 1) chunks.push({ __isChunk: true, text: "\n" })
  })
  return new StyledText(chunks)
}

interface MenuChoice {
  readonly name: string
  readonly description: string
  readonly value: string
}

export interface TuiOptions {
  readonly renderer?: CliRenderer
  /** Clock for the header animation; tests freeze it. */
  readonly now?: (() => number) | undefined
  readonly onSubmit: (text: string) => void
  readonly onInput: (value: string) => void
  readonly onAbort: () => void
  readonly onPickSession: (session: SessionChoice) => void
  readonly onPickProject: (project: ProjectChoice) => void
  readonly onPickCommand: (name: string) => void
}

export interface Tui {
  render(state: TuiState): void
  showSessions(sessions: readonly SessionChoice[], selectedId?: string, selectedAgent?: string): void
  showProjects(projects: readonly ProjectChoice[], currentName?: string): void
  /** A list of matching commands while the user types; the input keeps focus. */
  showCommandHint(commands: readonly TuiCommandInfo[]): void
  /** The same list as a modal the user can pick from; Escape returns to typing. */
  showCommandMenu(commands: readonly TuiCommandInfo[]): void
  /** Hides a non-modal command hint, leaving an open picker alone. */
  hideHint(): void
  hideMenu(): void
  destroy(): void
}

export async function createTui(options: TuiOptions): Promise<Tui> {
  const renderer = options.renderer ?? (await createCliRenderer({ exitOnCtrlC: true }))

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    gap: 1,
  })
  // Details on the left, the brand pushed to the right edge.
  const header = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: "100%",
    height: 1,
    justifyContent: "space-between",
    flexShrink: 0,
  })
  const headerInfo = new TextRenderable(renderer, { content: "root", wrapMode: "none", flexShrink: 1 })
  const headerBrandText = new TextRenderable(renderer, { content: brandContent(0), wrapMode: "none", flexShrink: 0 })
  header.add(headerInfo)
  header.add(headerBrandText)
  // ScrollBox draws its own border outside its layout box, which makes a long
  // transcript overflow and push the header and status off screen. Keep the
  // border on a wrapper so the height the flex layout reserves is the height
  // the transcript actually occupies.
  const transcriptFrame = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "column",
    border: true,
  })
  const transcript = new ScrollBoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
  })
  const body = new TextRenderable(renderer, { content: "Connecting…" })
  const input = new InputRenderable(renderer, {
    placeholder: "Ask the agent…  (/new, /sessions, /projects)",
    width: "100%",
  })
  const status = new TextRenderable(renderer, { content: "connecting" })

  // Kept out of the tree until `showSessions`, which gives the input back to
  // the picker until a session is chosen or Escape cancels.
  const picker = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    border: true,
    title: "Sessions",
    height: 3,
  })
  const select = new SelectRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    options: [],
    showDescription: true,
    wrapSelection: true,
  })
  let pickerVisible = false
  let menuKind: "sessions" | "commands" | "projects" | undefined
  let sessionChoices: readonly SessionChoice[] = []
  let projectChoices: readonly ProjectChoice[] = []

  picker.add(select)
  transcript.add(body)
  transcriptFrame.add(transcript)
  root.add(header)
  root.add(transcriptFrame)
  root.add(input)
  root.add(status)
  renderer.root.add(root)
  input.focus()

  // OpenTUI destroys the renderer on its own exit signals so the animation
  // timer and websocket callbacks must never touch the scene afterwards.
  let destroyed = false

  let lastState: TuiState | undefined
  const now = options.now ?? Date.now
  const startedAt = now()

  const paintHeader = (): void => {
    if (destroyed || lastState === undefined) return
    const elapsed = now() - startedAt
    // Root padding (1 each side) plus a space before the brand.
    const room = Math.max(0, renderer.width - 2 - gumWidth(elapsed) - 1)
    headerInfo.content = fitInfo(headerDetails(lastState).join(" · "), room)
    headerBrandText.content = brandContent(elapsed)
  }

  const stopAnimation = renderer.onAnimationTick(TICK_FPS, paintHeader)

  renderer.on(CliRenderEvents.DESTROY, () => {
    destroyed = true
    stopAnimation()
  })

  input.on(InputRenderableEvents.INPUT, () => {
    options.onInput(input.value)
  })

  input.on(InputRenderableEvents.ENTER, () => {
    const value = input.value.trim()
    if (value === "") return
    // Clear first so the input's own event hides a command hint before the
    // submitted command opens its own picker.
    input.value = ""
    options.onSubmit(value)
  })

  const closeMenu = (): void => {
    if (!pickerVisible) return
    pickerVisible = false
    menuKind = undefined
    root.remove(picker)
    if (!destroyed) input.focus()
  }

  const showMenu = (
    kind: "sessions" | "commands" | "projects",
    title: string,
    choices: readonly MenuChoice[],
    selected: number,
    modal: boolean,
  ): void => {
    menuKind = kind
    picker.title = title
    select.options = choices.map((choice) => ({ ...choice }))
    select.setSelectedIndex(selected)
    // Two lines per choice (name and description); the border takes the others.
    picker.height = Math.min(choices.length * 2 + 2, 12)
    if (!pickerVisible) {
      pickerVisible = true
      // Before the input, so the menu sits above the prompt line.
      root.add(picker, 2)
    }
    if (modal) {
      input.blur()
      select.focus()
    } else {
      input.focus()
    }
  }

  const commandChoices = (commands: readonly TuiCommandInfo[]): MenuChoice[] =>
    commands.map((command) => ({ name: command.name, description: command.description, value: command.name }))

  select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    const choice = select.getSelectedOption()
    const kind = menuKind
    closeMenu()
    if (choice === null || kind === undefined) return
    if (kind === "sessions") {
      const session = sessionChoices[Number(choice.value)]
      if (session !== undefined) options.onPickSession(session)
    } else if (kind === "projects") {
      const project = projectChoices[Number(choice.value)]
      if (project !== undefined) options.onPickProject(project)
    } else {
      options.onPickCommand(String(choice.value))
    }
  })

  // The command hint keeps the input focused so typing continues to filter it.
  // Its keys are handled here, before the input sees them.
  const hintOpen = (): boolean => pickerVisible && menuKind === "commands" && !select.focused

  const chooseHintedCommand = (): void => {
    const choice = select.getSelectedOption()
    closeMenu()
    input.value = ""
    if (choice !== null) options.onPickCommand(String(choice.value))
  }

  renderer.keyInput.on("keypress", (key) => {
    if (hintOpen()) {
      if (key.name === "up" || key.name === "down") {
        key.preventDefault()
        if (key.name === "up") select.moveUp()
        else select.moveDown()
        return
      }
      if (key.name === "return" || key.name === "linefeed") {
        key.preventDefault()
        chooseHintedCommand()
        return
      }
    }
    if (key.name !== "escape") return
    // Escape closes the menu before it reaches the abort shortcut.
    if (pickerVisible) {
      closeMenu()
      return
    }
    options.onAbort()
  })

  return {
    render(state) {
      if (destroyed) return
      const lines = viewLines(state)
      body.content = lines.length === 0 ? "No messages yet." : transcriptContent(lines)
      status.content = statusLine(state)
      lastState = state
      paintHeader()
    },
    showSessions(sessions, selectedId, selectedAgent) {
      if (destroyed) return
      sessionChoices = sessions
      const selected =
        selectedId === undefined
          ? 0
          : sessions.findIndex(
              (session) =>
                session.id === selectedId &&
                (selectedAgent === undefined || session.agent === undefined || session.agent === selectedAgent),
            )
      showMenu(
        "sessions",
        "Sessions",
        sessions.map((session, index) => ({
          name: session.title ?? session.id,
          description: `${session.project ?? "root"} · ${session.id}${session.busy ? " · running" : ""}`,
          value: String(index),
        })),
        selected === -1 ? 0 : selected,
        true,
      )
    },
    showProjects(projects, currentName) {
      if (destroyed) return
      projectChoices = projects
      const selected =
        currentName === undefined ? 0 : projects.findIndex((project) => project.name === currentName)
      showMenu(
        "projects",
        "Projects",
        projects.map((project, index) => ({
          name: project.name,
          description: project.remote === undefined ? "no git remote" : displayRemote(project.remote),
          value: String(index),
        })),
        selected === -1 ? 0 : selected,
        true,
      )
    },
    showCommandHint(commands) {
      if (destroyed) return
      showMenu("commands", "Commands", commandChoices(commands), 0, false)
    },
    showCommandMenu(commands) {
      if (destroyed) return
      showMenu("commands", "Commands", commandChoices(commands), 0, true)
    },
    hideHint() {
      if (destroyed) return
      // A focused picker is a deliberate choice; only the typing hint closes.
      if (menuKind === "commands" && !select.focused) closeMenu()
    },
    hideMenu() {
      if (destroyed) return
      closeMenu()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      stopAnimation()
      renderer.destroy()
    },
  }
}
