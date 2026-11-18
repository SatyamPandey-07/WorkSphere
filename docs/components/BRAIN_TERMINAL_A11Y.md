# Accessibility and Keyboard Navigation: BrainTerminal

## 1. Overview
The BrainTerminal component (src/components/chat/BrainTerminal.tsx) provides interactive terminal execution and hotkey navigation. It is built to comply with WCAG 2.1 AA standards, ensuring full usability for screen reader users and keyboard-only operators.

---

## 2. Keyboard Shortcuts & Navigation

| Key Combination | Action / Behavior |
| :--- | :--- |
| Tab / Shift + Tab | Navigate forward/backward through interactive elements and terminal focus zones. |
| Ctrl + K / Cmd + K | Clear the terminal buffer and reset the command history viewport. |
| Arrow Up / Arrow Down | Traverse through previous command execution history. |
| Escape | Dismiss active terminal focus or modal overlays. |

---

## 3. ARIA Roles & Screen Reader Attributes
* **ole="log"**: Applied to the terminal output container so assistive technologies announce newly appended terminal lines automatically.
* **ria-live="polite"**: Ensures screen readers announce execution output and responses without interrupting ongoing speech.
* **ria-atomic="false"**: Prevents screen readers from re-reading the entire terminal buffer on every new log entry, ensuring only incremental outputs are voiced.

---

## 4. Focus Traps & High-Contrast Styling
* **Focus Management**: Terminal focus is securely maintained within the active container during command execution loops to prevent keyboard trapping outside the console.
* **High-Contrast Theme**: Meets minimum 4.5:1 contrast ratios across terminal text (#A5B4FC / #67E8F9) against dark backdrops (#0F172A) for high legibility.
