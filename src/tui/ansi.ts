/**
 * Command output is untrusted and often colorized. OpenTUI renders text
 * literally and drops the ESC byte, so a colored line would show up as
 * `[32m…[39m`. Strip terminal sequences before display; newlines and tabs
 * survive, everything else in the C0 range does not.
 */
const ANSI =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[()#][0-9A-Za-z]|[\s\S])|\u009B[0-?]*[ -/]*[@-~]/g
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g

/** Removes ANSI escape sequences and non-printing control characters. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL, "")
}
