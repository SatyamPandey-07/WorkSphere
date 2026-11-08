# Component Reference Guide: SocialShareButton & Cross-Platform Sharing

This reference guide documents WorkSphere's `SocialShareButton` component, prop specifications, Web Share API integration, dual-tier clipboard fallback mechanisms, and platform-specific social sharing helpers ([src/components/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/SocialShareButton.tsx) and [src/components/social/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/social/SocialShareButton.tsx)).

---

## Table of Contents

1. [Overview & Architectural Scope](#1-overview--architectural-scope)
2. [Component Props Specification](#2-component-props-specification)
   - [TypeScript Props Interface](#typescript-props-interface)
   - [Props Reference Table](#props-reference-table)
3. [Web Share API Behavior & Clipboard Fallback Engine](#3-web-share-api-behavior--clipboard-fallback-engine)
   - [Native Web Share API (`navigator.share`)](#native-web-share-api-navigatorshare)
   - [Async Clipboard API (`navigator.clipboard.writeText`)](#async-clipboard-api-navigatorclipboardwritetext)
   - [DOM Textarea Fallback (`document.execCommand`)](#dom-textarea-fallback-documentexeccommand)
   - [Execution Flow Diagram](#execution-flow-diagram)
4. [Platform-Specific Social Share Code Snippets](#4-platform-specific-social-share-code-snippets)
   - [Twitter / X Share Link Helper](#twitter--x-share-link-helper)
   - [LinkedIn Share Link Helper](#linkedin-share-link-helper)
   - [WhatsApp Share Link Helper](#whatsapp-share-link-helper)
   - [Unified Social Share Utility](#unified-social-share-utility)
5. [Usage Walkthroughs & Implementation Patterns](#5-usage-walkthroughs--implementation-patterns)
   - [Pattern 1: Workspace Session Share](#pattern-1-workspace-session-share)
   - [Pattern 2: Venue Detail Card Share with Custom Variant](#pattern-2-venue-detail-card-share-with-custom-variant)
   - [Pattern 3: Callback Handlers & Analytics Tracking](#pattern-3-callback-handlers--analytics-tracking)
6. [Accessibility (a11y) & Testing Guidelines](#6-accessibility-a11y--testing-guidelines)
   - [Screen Reader Accessibility](#screen-reader-accessibility)
   - [Automated Jest & React Testing Library Examples](#automated-jest--react-testing-library-examples)
7. [Repository File Reference Map](#7-repository-file-reference-map)

---

## 1. Overview & Architectural Scope

The `SocialShareButton` component enables users to share workspace booking links, venue profiles, and active collaborative sessions across desktop and mobile devices.

WorkSphere adopts a **multi-tier progressive enhancement sharing strategy**:
1. **Native OS Share Sheet:** Uses `navigator.share()` on mobile devices (iOS Safari, Android Chrome) to present system options (AirDrop, Messages, native apps).
2. **Modern Clipboard API:** Uses `navigator.clipboard.writeText()` for asynchronous, permission-checked clipboard writes on modern desktop browsers.
3. **Legacy DOM Textarea Fallback:** Uses an off-screen `<textarea>` element with `document.execCommand("copy")` for older mobile browsers, embedded webviews, and restrictive iframe contexts.

---

## 2. Component Props Specification

File: [src/components/social/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/social/SocialShareButton.tsx#L7-L14)

### TypeScript Props Interface

```typescript
export interface SocialShareButtonProps {
  /** Target URL to share. Defaults to current window.location.href. */
  url?: string;
  /** Title of the venue or workspace item being shared. */
  title?: string;
  /** Name of the venue for social card formatting. */
  venueName?: string;
  /** Visual button style variant. */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "iconOnly";
  /** Button text label. Defaults to "Share Session". */
  label?: string;
  /** Label displayed upon successful copy feedback. Defaults to "Copied!". */
  copiedLabel?: string;
  /** Additional Tailwind CSS class overrides. */
  className?: string;
  /** Optional callback triggered on successful copy or share. */
  onCopy?: (url: string) => void;
  /** Whether to render state icons (Link2 / Check / Share2). Defaults to true. */
  showIcon?: boolean;
}
```

### Props Reference Table

| Prop Name | Type | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | `window.location.href` | The URL string to be copied or shared. |
| `title` | `string` | `undefined` | Optional title of the workspace or session. |
| `venueName` | `string` | `undefined` | Optional name of the venue for social post context. |
| `variant` | `"primary" \| "secondary" \| "outline" \| "ghost" \| "iconOnly"` | `"outline"` | Specifies button background and border styling. |
| `label` | `string` | `"Share Session"` | Text displayed on the button in default state. |
| `copiedLabel` | `string` | `"Copied!"` | Text displayed temporarily ($2.5 \text{s}$) after successful copy. |
| `onCopy` | `(url: string) => void` | `undefined` | Callback invoked with shared URL upon copy completion. |
| `showIcon` | `boolean` | `true` | Controls rendering of leading Lucide icons (`Link2` / `Check`). |
| `className` | `string` | `""` | Additional Tailwind utility classes applied to the container. |

---

## 3. Web Share API Behavior & Clipboard Fallback Engine

File: [src/components/social/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/social/SocialShareButton.tsx#L20-L50)

The sharing pipeline employs a three-tier execution hierarchy:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USER CLICKS SHARE BUTTON                        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Check navigator.share (Mobile Native OS Share Sheet)            │
└──────────────────┬────────────────────────────────────┬──────────────────┘
                   │ Available                          │ Unavailable / Refused
                   ▼                                    ▼
┌──────────────────────────────────────┐   ┌───────────────────────────────┐
│ Present iOS / Android System Sheet   │   │ Tier 2: navigator.clipboard   │
└──────────────────────────────────────┘   └──────────────┬────────────────┘
                                                          │ Available
                                                          ▼
                                           ┌───────────────────────────────┐
                                           │ Async writeText(targetUrl)    │
                                           └──────────────┬────────────────┘
                                                          │ Fails / Restricted
                                                          ▼
                                           ┌───────────────────────────────┐
                                           │ Tier 3: DOM Textarea Fallback │
                                           │ (document.execCommand("copy"))│
                                           └───────────────────────────────┘
```

### Native Web Share API (`navigator.share`)

When operating in HTTPS contexts on supported mobile browsers, `navigator.share()` opens the native device share sheet:

```typescript
if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
  try {
    await navigator.share({
      title: title || `${venueName || "Venue"} on WorkSphere`,
      text: `Check out ${venueName || "this workspace"} on WorkSphere!`,
      url: targetUrl,
    });
    return true;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      // User cancelled native share sheet; treat cleanly
      return false;
    }
  }
}
```

### Async Clipboard API (`navigator.clipboard.writeText`)

If Web Share is unsupported or running on desktop, the component attempts to write directly to the user's system clipboard using the Web Clipboard API:

```typescript
if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to Tier 3 DOM fallback
  }
}
```

### DOM Textarea Fallback (`document.execCommand`)

For legacy browsers, restricted iframe containers, or non-secure contexts where `navigator.clipboard` is disabled, the function injects a hidden, off-screen `<textarea>`:

```typescript
export async function copyShareableLinkToClipboard(text: string): Promise<boolean> {
  // Tier 1 & 2 attempt above...

  // Tier 3: Off-screen DOM Textarea fallback
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) return true;
    } catch (err) {
      console.error("[SocialShareButton] Fallback copy failed:", err);
    }
  }

  return false;
}
```

---

## 4. Platform-Specific Social Share Code Snippets

For components requiring direct social platform deep-links (such as sharing to Twitter/X, LinkedIn, WhatsApp, or Facebook), developers can construct platform intents using URI encoding.

### Twitter / X Share Link Helper

```typescript
/**
 * Constructs a Twitter / X intent share URL.
 */
export function getTwitterShareUrl(url: string, text: string, hashtags: string[] = ["WorkSphere", "RemoteWork"]): string {
  const params = new URLSearchParams({
    url,
    text,
    hashtags: hashtags.join(","),
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}
```

### LinkedIn Share Link Helper

```typescript
/**
 * Constructs a LinkedIn share URL.
 */
export function getLinkedInShareUrl(url: string): string {
  const params = new URLSearchParams({
    url,
  });
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}
```

### WhatsApp Share Link Helper

```typescript
/**
 * Constructs a WhatsApp click-to-chat API share URL.
 */
export function getWhatsAppShareUrl(url: string, text: string): string {
  const fullText = `${text} ${url}`;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(fullText)}`;
}
```

### Unified Social Share Utility

```typescript
export interface SocialPlatformUrls {
  twitter: string;
  linkedIn: string;
  whatsApp: string;
  facebook: string;
  email: string;
}

export function generateSocialPlatformUrls(url: string, title: string, venueName?: string): SocialPlatformUrls {
  const shareText = `Check out ${venueName ? `${venueName}` : title} on WorkSphere!`;
  
  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    whatsApp: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${shareText} ${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${shareText}\n\n${url}`)}`,
  };
}
```

---

## 5. Usage Walkthroughs & Implementation Patterns

### Pattern 1: Workspace Session Share

```tsx
import { SocialShareButton } from "@/components/SocialShareButton";

export function SessionHeader({ sessionId }: { sessionId: string }) {
  const sessionUrl = `https://worksphere.app/sessions/${sessionId}`;

  return (
    <div className="flex items-center justify-between p-4 bg-zinc-900 rounded-2xl">
      <div>
        <h1 className="text-lg font-bold text-white">Active Coworking Session</h1>
        <p className="text-xs text-zinc-400">Invite teammates to join your room</p>
      </div>

      <SocialShareButton
        url={sessionUrl}
        label="Share Session"
        copiedLabel="Copied to Clipboard!"
      />
    </div>
  );
}
```

### Pattern 2: Venue Detail Card Share with Custom Variant

```tsx
import { SocialShareButton } from "@/components/SocialShareButton";

export function VenueCardHeader({ venue }: { venue: { id: string; name: string } }) {
  const venueUrl = `https://worksphere.app/venues/${venue.id}`;

  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xl font-bold text-zinc-100">{venue.name}</h2>
      <SocialShareButton
        url={venueUrl}
        venueName={venue.name}
        title={`Workplace Profile: ${venue.name}`}
        label={`Share ${venue.name}`}
        className="bg-violet-600 hover:bg-violet-500 text-white border-none"
      />
    </div>
  );
}
```

### Pattern 3: Callback Handlers & Analytics Tracking

```tsx
import { SocialShareButton } from "@/components/SocialShareButton";

export function TrackedShareButton({ venueId }: { venueId: string }) {
  const handleShareCopy = (url: string) => {
    // Analytics telemetry call
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "share", {
        method: "SocialShareButton",
        content_type: "venue",
        item_id: venueId,
        url,
      });
    }
  };

  return (
    <SocialShareButton
      venueName="Ada's Technical Books & Cafe"
      onCopy={handleShareCopy}
    />
  );
}
```

---

## 6. Accessibility (a11y) & Testing Guidelines

### Screen Reader Accessibility

- **Keyboard Focus:** The button includes standard focus ring indicators (`focus-visible:ring-2 focus-visible:ring-violet-400`).
- **Dynamic ARIA Labels:** Employs `aria-label={label}` which dynamically updates or announces `copiedLabel` to screen readers when state transitions occur.
- **Testing Attributes:** Includes `data-testid="share-session-button"`, `data-testid="share-icon-link"`, and `data-testid="share-icon-check"` for end-to-end integration testing.

### Automated Jest & React Testing Library Examples

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SocialShareButton } from "@/components/SocialShareButton";

describe("SocialShareButton", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(true),
      },
    });
  });

  it("renders default label and icon", () => {
    render(<SocialShareButton label="Share Workspace" />);
    expect(screen.getByText("Share Workspace")).toBeInTheDocument();
  });

  it("copies URL to clipboard and displays feedback state on click", async () => {
    const onCopyMock = jest.fn();
    render(
      <SocialShareButton
        url="https://worksphere.app/v/123"
        onCopy={onCopyMock}
      />
    );

    const button = screen.getByTestId("share-session-button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://worksphere.app/v/123");
      expect(onCopyMock).toHaveBeenCalledWith("https://worksphere.app/v/123");
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });
});
```

---

## 7. Repository File Reference Map

- [src/components/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/SocialShareButton.tsx) — Main entry point re-exporting `SocialShareButton`.
- [src/components/social/SocialShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/social/SocialShareButton.tsx) — Core component implementation, `copyShareableLinkToClipboard` helper, and toast integrations.
- [src/components/social/VenueShareButton.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/social/VenueShareButton.tsx) — Specialized venue sharing button with direct `navigator.share()` integration.
- [src/components/venue/VenueShareModal.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/venue/VenueShareModal.tsx) — Full-featured venue sharing modal containing QR code generator and social platform links.
