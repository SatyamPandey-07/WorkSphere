# Venue Search Keyboard Shortcut and Accessibility Guide

Comprehensive developer and accessibility documentation for WorkSphere's Venue Search keyboard shortcut (`⌘K` / `Ctrl+K`), platform modifier detection, input focus behavior, ARIA keyboard accessibility attributes, and screen-reader announcements.

---

## Table of Contents

1. [Overview](#1-overview)
   - [Purpose of the Global Venue Search Shortcut](#purpose-of-the-global-venue-search-shortcut)
   - [Supported Shortcut Combinations](#supported-shortcut-combinations)
   - [Activation Workflows](#activation-workflows)
2. [Platform Modifier Detection](#2-platform-modifier-detection)
   - [The `usePlatformModifier` Hook Architecture](#the-useplatformmodifier-hook-architecture)
   - [Platform Detection Logic (`isMacPlatform` and User-Agent Parsing)](#platform-detection-logic-ismacplatform-and-user-agent-parsing)
   - [Dynamic Modifier Key and Badge Formatting](#dynamic-modifier-key-and-badge-formatting)
   - [SSR Hydration Safety](#ssr-hydration-safety)
   - [Source Implementation References](#source-implementation-references)
3. [Input Focus and Keyboard Event Handling](#3-input-focus-and-keyboard-event-handling)
   - [Global Keyboard Listener Registration and Lifecycle](#global-keyboard-listener-registration-and-lifecycle)
   - [Typing in Regular Input Elements](#typing-in-regular-input-elements)
   - [Behavior Inside Textareas](#behavior-inside-textareas)
   - [Behavior Inside Select Dropdowns](#behavior-inside-select-dropdowns)
   - [Behavior Inside ContentEditable Regions](#behavior-inside-contenteditable-regions)
   - [Modifier Key Combination Filters and Strictness](#modifier-key-combination-filters-and-strictness)
   - [Focus Transfer, Text Selection, and History Dropdown Activation](#focus-transfer-text-selection-and-history-dropdown-activation)
   - [Verified Behavior vs. Accessibility Recommendations](#verified-behavior-vs-accessibility-recommendations)
4. [ARIA Keyboard Accessibility](#4-aria-keyboard-accessibility)
   - [Purpose and Standard of `aria-keyshortcuts`](#purpose-and-standard-of-aria-keyshortcuts)
   - [Component Application and Attribute Values](#component-application-and-attribute-values)
   - [Assistive Technology Interoperability](#assistive-technology-interoperability)
   - [Conditional Shortcut Exposure](#conditional-shortcut-exposure)
5. [Screen Reader Announcements](#5-screen-reader-announcements)
   - [Live Region Implementation (`aria-live`)](#live-region-implementation-aria-live)
   - [Live Region Role and Politeness Settings](#live-region-role-and-politeness-settings)
   - [Search State Changes and Announcement Triggers](#search-state-changes-and-announcement-triggers)
   - [Deduplication and Repetition Prevention](#deduplication-and-repetition-prevention)
   - [Verified vs. Unimplemented Live Region Behaviors](#verified-vs-unimplemented-live-region-behaviors)
6. [Accessibility Verification Checklist](#6-accessibility-verification-checklist)
7. [Source File References and Architecture Map](#7-source-file-references-and-architecture-map)

---

## 1. Overview

### Purpose of the Global Venue Search Shortcut

WorkSphere connects mobile professionals, digital nomads, and remote teams with work-ready venues, quiet study cafes, coworking spaces, and meeting hubs. Finding spaces quickly requires frictionless access to search functionality from anywhere across the application viewport.

The global search keyboard shortcut provides:
- **Instant Discovery:** Fast focus handoff to the primary search bar or workspace command palette without requiring cursor or mouse navigation.
- **Context Preservation:** Keyboard navigation across complex layouts (such as maps, seating matrices, or analytics dashboards) without loss of position.
- **Power User Ergonomics:** Standardized desktop hotkey patterns matching operating system conventions (`⌘K` on Apple platforms, `Ctrl+K` on Windows/Linux).

### Supported Shortcut Combinations

The WorkSphere design system standardizes the following shortcut combinations:

| Operating System / Environment | Key Combination | Primary Modifier | Symbol Representation | Label Representation |
| :--- | :--- | :--- | :--- | :--- |
| **macOS / iOS / iPadOS** | `⌘K` (`Meta+K`) | `Meta` (Command) | `⌘` | `Cmd` |
| **Windows** | `Ctrl+K` (`Control+K`) | `Control` | `Ctrl` | `Ctrl` |
| **Linux / BSD** | `Ctrl+K` (`Control+K`) | `Control` | `Ctrl` | `Ctrl` |
| **Android / ChromeOS / Other** | `Ctrl+K` (`Control+K`) | `Control` | `Ctrl` | `Ctrl` |

### Activation Workflows

Venue search activation in WorkSphere takes two complementary paths depending on component placement:

```
+--------------------------------------------------------------------------+
|                            USER INPUT (Keyboard)                         |
|                       macOS: [⌘ + K]   |   Windows/Linux: [Ctrl + K]    |
+--------------------------------------------------------------------------+
                                     |
                                     v
                       Global `keydown` Listener
                                     |
                   +-----------------+-----------------+
                   | Target inside editable control?   |
                   +-----------------+-----------------+
                          /                     \
                      YES /                       \ NO
                         v                         v
               [Ignore Keystroke]           [Prevent Default]
            (Allow native text entry)              |
                                                   v
                         +-------------------------+-------------------------+
                         |                                                   |
                         v                                                   v
               [Inline Venue Search]                                [Command Palette Modal]
             `VenueSearchInput` / `SearchBar`                          `CommandPalette`
                         |                                                   |
                         v                                                   v
           - `input.focus()`                                   - `setOpen(true)`
           - `input.select()` (full query)                     - Trap focus inside dialog
           - Open search history dropdown                      - Auto-focus `<CommandInput />`
```

1. **Inline Venue Search Bar (`VenueSearchInput` / `SearchBar`):**
   - The user presses `⌘K` or `Ctrl+K`.
   - The global listener intercepts the event, calls `event.preventDefault()`, immediately places focus into the input field (`inputRef.current.focus()`), highlights existing search text (`inputRef.current.select()`), and opens recent search history.
2. **Global Command Palette (`CommandPalette` / `QuickSearchTrigger`):**
   - Triggered globally or via the `<QuickSearchTrigger />` navbar component.
   - Dispatches or listens to `worksphere:open-command-palette` and opens a floating modal dialog containing workspace-wide venue quick actions.

---

## 2. Platform Modifier Detection

### The `usePlatformModifier` Hook Architecture

Platform detection is encapsulated in the reusable custom hook `usePlatformModifier` located at `src/hooks/usePlatformModifier.ts`. It provides dynamic modifier metadata, formatting utilities, and ARIA shortcut strings.

```typescript
// src/hooks/usePlatformModifier.ts
export function usePlatformModifier() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(isMacPlatform());
  }, []);

  const modifierSymbol = isMac ? "⌘" : "Ctrl";
  const modifierLabel = isMac ? "Cmd" : "Ctrl";
  const modifierKey = isMac ? "Meta" : "Control";

  const formatShortcut = (
    key: string,
    options?: { symbol?: boolean; separator?: string },
  ): string => {
    const { symbol = false, separator = " + " } = options || {};
    if (isMac) {
      return symbol ? `⌘${key}` : `Cmd${separator}${key}`;
    }
    return `Ctrl${separator}${key}`;
  };

  const getAriaKeyshortcuts = (key: string): string => {
    return `Control+${key} Meta+${key}`;
  };

  return {
    isMac,
    modifierSymbol,
    modifierLabel,
    modifierKey,
    formatShortcut,
    getAriaKeyshortcuts,
  };
}
```

### Platform Detection Logic (`isMacPlatform` and User-Agent Parsing)

Platform detection is implemented as a pure function `isMacPlatform()`:

```typescript
// src/hooks/usePlatformModifier.ts
export function isMacPlatform(userAgent?: string, platform?: string): boolean {
  if (typeof window === "undefined" && !userAgent && !platform) {
    return false;
  }
  const ua = userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const plat = platform || (typeof navigator !== "undefined" ? (navigator as any).userAgentData?.platform || navigator.platform : "");
  return /(Mac|iPhone|iPod|iPad)/i.test(ua) || /(Mac|iPhone|iPod|iPad)/i.test(plat);
}
```

Key aspects of this implementation:
- **Dual String Inspection:** Inspects both `navigator.userAgent` and platform descriptors (`navigator.userAgentData?.platform` or legacy `navigator.platform`).
- **Apple Ecosystem Coverage:** Matches `Mac`, `iPhone`, `iPod`, and `iPad` via a case-insensitive regular expression (`/(Mac|iPhone|iPod|iPad)/i`).
- **SSR Safe Guards:** Guarded against execution outside browser runtimes (`typeof window === "undefined"` and `typeof navigator === "undefined"`), preventing build failures during Next.js server-side rendering or static site generation.

### Dynamic Modifier Key and Badge Formatting

Components render platform-appropriate visual badges based on the detected environment:

1. **Badge Text:**
   - On macOS/iOS: Displays `⌘K`.
   - On Windows/Linux: Displays `Ctrl+K`.
2. **Visual Styling:**
   - The badge is rendered using semantic `<kbd>` elements:
     ```tsx
     <kbd
       data-testid="search-shortcut-badge"
       aria-label={`Shortcut: ${isMac ? "Command" : "Control"} plus K`}
       className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 shadow-sm md:inline-flex"
     >
       {displayedShortcut}
     </kbd>
     ```
   - On smaller screens (`< 768px`), the badge is hidden via `hidden md:inline-flex` to prevent crowding mobile viewports.

### SSR Hydration Safety

Directly accessing `navigator.userAgent` during initial component render can produce React hydration mismatch errors (`Text content did not match server-rendered HTML`).

To prevent hydration mismatches:
1. `usePlatformModifier` initializes `isMac` state to `false` during server rendering and initial client hydration.
2. The `useEffect` hook triggers immediately post-mount on the client to evaluate `isMacPlatform()`, updating `isMac` to `true` if running on an Apple platform.
3. Synchronous evaluations via `getPlatformModifier(userAgent, platform)` are available for server components or middleware where user-agent headers are passed explicitly.

### Source Implementation References

- Hook definition: `src/hooks/usePlatformModifier.ts`
- Hook tests: `src/__tests__/hooks/usePlatformModifier.test.ts`
- Dedicated badge component: `src/components/ui/KeyboardShortcutBadge.tsx`
- Search bar badge consumer: `src/components/search/VenueSearchInput.tsx` and `src/components/SearchBar.tsx`

---

## 3. Input Focus and Keyboard Event Handling

### Global Keyboard Listener Registration and Lifecycle

The venue search input listens for global keystrokes using a standard `window.addEventListener("keydown", handleGlobalKeyDown)` pattern.

```typescript
// Global keydown registration pattern
useEffect(() => {
  if (!enableShortcut) return;

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "k") return;

    // Check platform modifier match
    const shortcutMatches = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    if (
      !shortcutMatches ||
      event.altKey ||
      event.shiftKey ||
      (event.metaKey && event.ctrlKey)
    ) {
      return;
    }

    // Guard against input, textarea, select, and contenteditable elements
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tagName = target.tagName.toLowerCase();
      if (
        target !== inputRef.current &&
        (tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          target.isContentEditable ||
          target.closest('[contenteditable="true"]'))
      ) {
        return;
      }
    }

    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    setIsDropdownOpen(true);
  };

  window.addEventListener("keydown", handleGlobalKeyDown);
  return () => window.removeEventListener("keydown", handleGlobalKeyDown);
}, [enableShortcut, isMac]);
```

### Typing in Regular Input Elements

When a user is actively typing in a form input (e.g., booking form guest count, billing credit card number, or room name filter):
- `target.tagName.toLowerCase() === "input"` evaluates to `true`.
- If `target !== inputRef.current`, the handler immediately returns.
- **Result:** Pressing `Ctrl+K` or `⌘K` inside another text input does not trigger venue search or steal focus away from user input.

### Behavior Inside Textareas

When a user writes in multi-line textareas (e.g., venue review descriptions, amenity feedback, support messages):
- `target.tagName.toLowerCase() === "textarea"` evaluates to `true`.
- The handler terminates execution without calling `preventDefault()`.
- **Result:** Native browser cursor and text manipulation commands remain active.

### Behavior Inside Select Dropdowns

When focused on native dropdown menus:
- `target.tagName.toLowerCase() === "select"` evaluates to `true`.
- The handler terminates execution without hijacking focus.
- **Result:** Users can navigate option lists or close dropdowns using native OS behaviors.

### Behavior Inside ContentEditable Regions

Collaborative tools and rich-text note editors in WorkSphere utilize `contenteditable="true"` containers:
- The handler executes two distinct checks:
  1. `target.isContentEditable`: Checks whether the direct event target has editing enabled.
  2. `target.closest('[contenteditable="true"]')`: Checks whether the target is a descendant child (such as a `<span>`, `<p>`, or `<strong>` tag) nested inside a rich-text block.
- **Result:** Keystrokes inside rich-text editors will never mistakenly activate venue search.

### Modifier Key Combination Filters and Strictness

To avoid collisions with operating system, browser, or accessibility tools, the listener enforces strict modifier exclusivity:

| Modifier State | Key Event | macOS Behavior | Windows/Linux Behavior | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `Ctrl + K` | Keystroke | Ignored (`!shortcutMatches`) | **Triggers Search** | Windows/Linux primary shortcut |
| `⌘ + K` (`Meta + K`) | Keystroke | **Triggers Search** | Ignored (`!shortcutMatches`) | macOS primary shortcut |
| `Ctrl + Meta + K` | Keystroke | Ignored (`metaKey && ctrlKey`) | Ignored (`metaKey && ctrlKey`) | Ambiguous multi-modifier chord |
| `Ctrl + Shift + K` | Keystroke | Ignored (`event.shiftKey`) | Ignored (`event.shiftKey`) | Conflicts with browser devtools / console |
| `Meta + Shift + K` | Keystroke | Ignored (`event.shiftKey`) | Ignored (`event.shiftKey`) | Reserved browser / OS shortcuts |
| `Ctrl + Alt + K` | Keystroke | Ignored (`event.altKey`) | Ignored (`event.altKey`) | Reserved third-party application shortcut |
| `Meta + Alt + K` | Keystroke | Ignored (`event.altKey`) | Ignored (`event.altKey`) | Reserved macOS system hotkey |

### Focus Transfer, Text Selection, and History Dropdown Activation

When all filter conditions pass:
1. `event.preventDefault()` is invoked to prevent default browser behavior (e.g., standard browser address bar search or link insertion).
2. `input.focus()` moves active keyboard focus directly into the search input.
3. `input.select()` highlights the entire existing text query, allowing the user to immediately overwrite it or press backspace.
4. `setIsDropdownOpen(true)` automatically opens recent search suggestions and saved history.

### Verified Behavior vs. Accessibility Recommendations

> [!NOTE]
> **Verified In-Code Behavior:**
> - `target !== inputRef.current` ensures re-pressing the shortcut while already focused on the venue input re-triggers text selection (`input.select()`).
> - Focus restoration when closing modal overlays (such as `CommandPalette`) restores focus to `previousFocusRef.current`.
>
> **Recommended Best Practices (Guidance for Contributors):**
> - Avoid assigning shortcuts containing only single alphanumeric keys (`K` without modifier) to prevent conflicts with assistive screen readers in browse mode.
> - Ensure all interactive controls opened by shortcuts allow seamless dismissal with the `Escape` key, restoring focus to the initiating trigger.

---

## 4. ARIA Keyboard Accessibility

### Purpose and Standard of `aria-keyshortcuts`

The W3C WAI-ARIA specification defines `aria-keyshortcuts` to expose keyboard shortcuts to assistive technologies, such as screen readers (NVDA, JAWS, VoiceOver) and speech input software.

By surfacing `aria-keyshortcuts`, assistive technologies can:
- Inform users of available shortcuts when an element receives focus.
- Avoid swallowing or intercepting shortcuts that conflict with screen-reader navigation modes.
- Present shortcut cheat sheets in accessibility inspection trees.

### Component Application and Attribute Values

In WorkSphere, `aria-keyshortcuts` is formatted according to W3C specification syntax (modifier names capitalized and separated by plus signs):

```tsx
// Pattern 1: Platform-specific exposure (VenueSearchInput.tsx)
<input
  ref={inputRef}
  type="search"
  aria-keyshortcuts={enableShortcut ? (isMac ? "Meta+K" : "Control+K") : undefined}
  aria-label="Search venues"
  data-testid="venue-search-input"
/>

// Pattern 2: Dual-platform string exposure (usePlatformModifier & CommandPalette)
// Formatted by getAriaKeyshortcuts("K") -> "Control+K Meta+K"
<CommandInput
  ref={inputRef}
  aria-keyshortcuts="Control+K Meta+K"
  aria-label="Search workspace commands"
/>
```

### Assistive Technology Interoperability

- **Single-Platform Specification (`Meta+K` vs. `Control+K`):** When rendered dynamically in `VenueSearchInput`, assistive tools announce only the hotkey relevant to the user's active operating system.
- **Space-Delimited Alternatives (`Control+K Meta+K`):** According to W3C recommendations, multiple shortcut alternatives are delimited by space characters. Screen readers inspect the sequence and map to the active platform's modifier set.
- **Screen Reader Interaction Mode:** On macOS VoiceOver, pressing `⌘K` passes through directly to the document window. On Windows NVDA/JAWS, users operating in virtual cursor mode can trigger `Control+K` to immediately enter focus/forms mode inside the search bar.

### Conditional Shortcut Exposure

When keyboard shortcuts are disabled (e.g., via `enableShortcut={false}` in embedded widgets or simplified modal views):
- The `aria-keyshortcuts` attribute is removed (`undefined`).
- The visual `<kbd>` badge is omitted from the DOM.
- No global `keydown` event listener is attached to `window`.

---

## 5. Screen Reader Announcements

### Live Region Implementation (`aria-live`)

WorkSphere provides polite status announcements for dynamic search actions via dedicated `aria-live` containers.

```tsx
<div
  role="status"
  aria-live="polite"
  data-testid="search-history-live-region"
  className="sr-only"
>
  {statusAnnouncement}
</div>
```

### Live Region Role and Politeness Settings

1. **Role (`role="status"`):**
   - Declares the container as an advisory region presenting status updates that do not interrupt user task execution.
2. **Politeness (`aria-live="polite"`):**
   - Ensures screen readers wait until the user pauses typing or finishes current speech output before announcing updates.
   - Contrast with `aria-live="assertive"`, which would aggressively disrupt ongoing speech synthesis.
3. **Screen-Reader Only Visibility (`className="sr-only"`):**
   - Hides the container visually using utility classes (`clip: rect(0, 0, 0, 0); overflow: hidden; position: absolute; height: 1px; width: 1px;`) while keeping it fully accessible to assistive trees.

### Search State Changes and Announcement Triggers

The following live-region announcements are implemented in WorkSphere search components:

| Component | Trigger Condition | Announcement Message | Politeness |
| :--- | :--- | :--- | :--- |
| `VenueSearchInput` | User clicks "Clear all" search history | `"Search history cleared."` | `polite` |
| `EnhancedChatbot` / `LiveAnnouncer` | Venue results updated via search / filter | `"Showing X venue results matching query."` | `polite` |
| `VenueSearchInput` | Dropdown expansion / collapse | Controlled via `aria-expanded` and `role="combobox"` | State attribute |

### Deduplication and Repetition Prevention

To avoid overwhelming screen reader users:
- **Repetitive Announcements:** State messages are not announced continuously during every character typed. Instead, search inputs utilize standard combobox attributes (`aria-expanded`, `aria-autocomplete="list"`, `aria-controls`) so assistive tools handle list expansion natively without spamming announcements.
- **Debounced Feedback:** Query debouncing (typically 300ms) buffers live search fetches, preventing rapid screen reader updates during rapid typing.

### Verified vs. Unimplemented Live Region Behaviors

> [!IMPORTANT]
> **Verified in Codebase:**
> - `role="status"` and `aria-live="polite"` exist in `VenueSearchInput` for `"Search history cleared."` action feedback.
> - `LiveAnnouncer` in `src/lib/venueResultsAnnouncement.ts` and `EnhancedChatbot.tsx` formats and announces venue result counts.
> - Combobox state changes are communicated via `aria-expanded="true|false"` on the `<input>` element.
>
> **Unimplemented / Not Present:**
> - The application **does not** announce an audible text string such as `"Search opened"` or `"Search dialog opened"` into an `aria-live` region upon pressing `⌘K` / `Ctrl+K`. Focus movement to an element with an accessible name (`aria-label="Search venues"`) is the standard mechanism by which screen readers announce arrival in the search input.

---

## 6. Accessibility Verification Checklist

Use this practical checklist for manual testing and automated regression verification of venue search shortcuts across environments:

### Platform & Shortcut Display
- [ ] **macOS Badge Rendering:** On macOS Safari/Chrome, the shortcut badge renders as `⌘K`.
- [ ] **Windows/Linux Badge Rendering:** On Windows/Linux browsers, the shortcut badge renders as `Ctrl+K`.
- [ ] **Responsive Visibility:** The shortcut `<kbd>` badge is hidden on small mobile viewports (`< 768px`) and visible on desktop viewports.
- [ ] **Disabled Mode (`enableShortcut={false}`):** The shortcut badge is completely removed from the DOM when shortcuts are disabled.

### Shortcut Trigger & Focus Management
- [ ] **Global Activation:** Pressing `⌘K` (macOS) or `Ctrl+K` (Windows/Linux) focuses the venue search input.
- [ ] **Default Action Prevented:** Pressing the shortcut does not trigger default browser URL bar search or page shortcuts.
- [ ] **Full Text Selection:** Activating the shortcut when the input contains text highlights all existing characters.
- [ ] **Dropdown Display:** Activating the shortcut automatically displays recent search history items if present.
- [ ] **Re-Focus Idempotency:** Pressing the shortcut while already focused on the venue search input maintains focus and re-selects query text.

### Exclusion & Typing Isolation
- [ ] **Text Input Isolation:** Pressing `⌘K` / `Ctrl+K` while typing in a standard `<input type="text">` does not trigger venue search.
- [ ] **Textarea Isolation:** Pressing `⌘K` / `Ctrl+K` while typing in a `<textarea>` does not trigger venue search.
- [ ] **Select Menu Isolation:** Pressing `⌘K` / `Ctrl+K` while focused on a `<select>` dropdown does not trigger venue search.
- [ ] **ContentEditable Isolation:** Pressing `⌘K` / `Ctrl+K` inside a `contenteditable="true"` container does not trigger venue search.
- [ ] **Nested Editable Isolation:** Pressing `⌘K` / `Ctrl+K` inside elements nested within a contenteditable region does not trigger venue search.
- [ ] **Strict Modifier Enforcement:** Key chords such as `Ctrl+Shift+K`, `Alt+K`, or `Ctrl+Meta+K` are ignored and do not activate search.

### ARIA & Screen Reader Accessibility
- [ ] **`aria-keyshortcuts` Presence:** The `<input>` element exposes an accurate `aria-keyshortcuts` attribute (`Meta+K` or `Control+K`).
- [ ] **Combobox Pattern:** The input specifies `role="combobox"`, `aria-autocomplete="list"`, and valid `aria-controls`.
- [ ] **`aria-expanded` Synchronization:** `aria-expanded` accurately reflects whether the history or results dropdown is open (`true`) or closed (`false`).
- [ ] **Escape Key Handling:** Pressing `Escape` closes the dropdown and updates `aria-expanded="false"`.
- [ ] **Live Region Politeness:** Live regions use `role="status"` and `aria-live="polite"` without interrupting ongoing speech.
- [ ] **Clear History Announcement:** Clicking "Clear all" updates the live region with `"Search history cleared."`.

---

## 7. Source File References and Architecture Map

The following source files comprise the search shortcut and accessibility subsystem in WorkSphere:

```
src/
├── hooks/
│   └── usePlatformModifier.ts           # Pure platform detection, modifier labels, and event dispatchers
│
├── components/
│   ├── search/
│   │   ├── VenueSearchInput.tsx         # Combobox input, shortcut badge, ARIA attributes, and global listener
│   │   └── SearchBar.tsx                # Form wrapper integrating VenueSearchInput with search queries
│   │
│   ├── ui/
│   │   ├── KeyboardShortcutBadge.tsx    # Accessible <kbd> component with platform modifier detection
│   │   ├── QuickSearchTrigger.tsx       # Navbar trigger with targeting reticles and shortcut hints
│   │   └── ShortcutTooltip.tsx          # Accessible tooltip displaying hotkey hints
│   │
│   ├── CommandPalette.tsx               # Modal command palette listening for global Ctrl+K / Cmd+K
│   └── SearchBar.tsx                    # Legacy root search bar with platform badge and focus handling
│
└── __tests__/
    ├── hooks/
    │   └── usePlatformModifier.test.ts  # Unit tests for platform modifier detection and formatting
    └── components/
        └── search/
            └── VenueSearchInput.test.tsx# Unit tests for focus handling, modifier exclusions, and ARIA attributes
```
