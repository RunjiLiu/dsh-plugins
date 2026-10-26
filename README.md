# Composer Lists — `@local/dsh-composer-rich-input`

Web GUI composer enhancement for DeepSeek Harness. It works on the shipped
resident composer (a plain-text Lexical editor) and adds four behaviours
without replacing it.

| Gesture | Result |
| --- | --- |
| `Shift+Enter` on a line that starts with `1. `, `1) `, `- `, `* `, `+ `, `• ` | Writes the next item as its own paragraph and continues the numbering or bullet. |
| `Shift+Enter` on an empty item (only the marker) | Removes the marker and leaves the list. |
| `Tab` / `Shift+Tab` on a list line | Indents or outdents that line by two spaces, so nested levels line up under the parent item's text. |
| `Ctrl+E` | Moves the caret to the end of the current line. |
| Typing any list marker | The paragraph gets a hanging indent, so the text after the marker and every wrapped continuation line align. |

Outside a list line, `Tab` keeps its native focus traversal, and while the `/`
or `@` menu is open the menu keeps `Tab` for settling the highlighted row.

## Why Shift+Enter

Plain `Enter` sends (or queues/steers) in this composer, and `Ctrl/Cmd+Enter`
uses the complementary delivery mode. `Shift+Enter` is the only newline
gesture, so list continuation rides it.

## What is and is not rich text

The draft stays plain text: the `1. ` marker is literal characters, and the
alignment is a hanging indent applied to the paragraph that starts with the
marker (`padding-left` plus a negative `text-indent`, measured from the actual
font). Nothing is sent to the model except the same plain text you typed,
including its line breaks.

Real rich-text constructs (Lexical list nodes, bold/italic marks, nested
levels, automatic renumbering after deleting an item) are owned by the composed
editor and are not available to a plugin: the composer registers no list node
and exposes no keymap or node API. This bundle is a presentation/behaviour
layer on top of the editor's public input actions.

## Implementation notes

- The draft edit goes through the composer's public input actions
  (`inputActions.captureInsertion()` and `inputActions.setDraft()`), so Lexical
  state, draft persistence and the submitted text remain canonical.
- `setDraft` re-creates the draft with one paragraph per line. That is what
  gives every list item its own block to align.
- Continuation only happens when the caret is at the end of a plain-text draft
  with no reference/command chips and the composer is in its `plain` phase.
  Every other posture (mid-text caret, selection, `/command` claim, `@file`
  chips, IME composition) keeps the shipped `Shift+Enter` line break.
- A paragraph holding several marker lines (a pasted list, which is one
  paragraph with `<br>` breaks) is left unindented rather than indenting the
  wrong lines. Press `Shift+Enter` once inside it and the list is rewritten
  into one paragraph per item.
- `Shift+Enter` merges into the previous undo entry (the composer's seed
  semantics), so `Ctrl+Z` after a continuation may undo more than one step.

## Uninstall

Settings → Plugins → Composer Lists → Disable, or remove the bundle
`@local/dsh-composer-rich-input`.
