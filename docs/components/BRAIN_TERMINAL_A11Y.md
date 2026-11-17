# Brain Terminal Accessibility

## Scope

The Brain Terminal is a non-modal command panel. It does not trap focus: normal browser Tab and Shift+Tab order is preserved so keyboard users can enter and leave the panel without becoming stuck.

## Keyboard interactions

| Key | Behavior | Scope |
|---|---|---|
| Tab | Move to the next interactive control | Native document tab order |
| Shift + Tab | Move to the previous interactive control | Native document tab order |
| Arrow Up | Recall the previous submitted command | Focus in the command input |
| Arrow Down | Move forward in command history; restore the unsent draft at the newest boundary | Focus in the command input |
| Enter | Submit a non-empty command | Focus in the command input |
| Ctrl + K / Cmd + K | Clear terminal output, current draft, and command history; keep focus in the command input | Only while the event target is inside the Brain Terminal |
| Escape | Close the terminal when an `onClose` handler is provided | While the terminal is open |

The Ctrl/Cmd+K shortcut is deliberately panel-scoped. It must not consume the application's global venue-search shortcut when focus is elsewhere.

## Screen-reader announcements

The execution output uses `role="log"`, `aria-live="polite"`, and `aria-atomic="false"`. New output is announced without interrupting the current speech. The log is labelled “Brain terminal execution log”. Command input, submit, maximize, restore, and close controls have accessible names.

## Focus and visual contrast

The panel is not a modal and therefore does not implement a focus trap. Its controls remain in the normal Tab sequence. Maintain at least 4.5:1 contrast for normal text and 3:1 for UI boundaries and focus indicators. Provide a visible `:focus-visible` outline and preserve it in `@media (forced-colors: active)` using system colors (for example `Highlight` / `HighlightText`). Do not rely on colored agent icons or animated glow alone to communicate focused or active state.

## Verification checklist

1. Tab through the command input, quick-command chips, submit button, and header controls; confirm focus can leave the panel.
2. With focus in the command input, submit two commands, press Arrow Up/Down, then press Ctrl+K (or Cmd+K); confirm the output and history are cleared and focus remains in the input.
3. Move focus outside the panel and press Ctrl+K; confirm this component does not consume the keystroke.
4. Use a screen reader and confirm new execution output is announced politely through the log region.
5. Test visible focus indicators with the browser's forced-colors/high-contrast setting.

## Related guidance

See [WorkSphere keyboard navigation and shortcuts](../accessibility/keyboard-shortcuts.md).
