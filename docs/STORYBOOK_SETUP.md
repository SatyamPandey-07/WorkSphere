# Storybook Setup & Integration Guide

This guide explains how to set up Storybook for isolated UI component development within the WorkSphere project. It covers initialization, component story structures, and how to mock Clerk authentication to ensure components render correctly in isolation.

## 1. Installation and Initialization

To set up Storybook in this Next.js project, run the following command from the project root:

```bash
npx storybook@latest init
```

During initialization, Storybook will auto-detect the Next.js framework and configure itself accordingly.

### Tailwind CSS Configuration

Because WorkSphere uses Tailwind CSS, ensure that Tailwind's styles are imported into Storybook.
In `.storybook/preview.ts` (or `preview.tsx`), import your global CSS file:

```tsx
import "../src/app/globals.css"; // Adjust the path if necessary

import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
};

export default preview;
```

## 2. Component Story Structure

To maintain organization, stories should be co-located with their respective components.

### File Naming Convention

Place your `.stories.tsx` files adjacent to the component they document:
`src/components/ui/Button/Button.tsx` -> `src/components/ui/Button/Button.stories.tsx`

### Basic Story Boilerplate

Use Component Story Format (CSF) to write your stories:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { MyComponent } from "./MyComponent";

const meta: Meta<typeof MyComponent> = {
  title: "Components/MyComponent",
  component: MyComponent,
  tags: ["autodocs"], // Enables auto-generated documentation
  argTypes: {
    // Define interactive controls here
  },
};

export default meta;
type Story = StoryObj<typeof MyComponent>;

export const Default: Story = {
  args: {
    // Default props
    title: "Hello World",
  },
};
```

## 3. Mocking Clerk Authentication

Many components in WorkSphere depend on Clerk hooks (e.g., `useAuth`, `useUser`). These will throw errors in Storybook if the Clerk provider context is missing.

To solve this, we can wrap our stories in a mocked Clerk context or use a custom decorator.

### Using a Global Decorator

You can add a mocked Clerk provider to `.storybook/preview.tsx` so that all stories automatically inherit a mock authentication state.

First, install the mock wrapper (if available) or create a simple mock provider:

```tsx
// .storybook/preview.tsx
import React from "react";
import type { Preview } from "@storybook/react";
import { ClerkProvider } from "@clerk/nextjs";
import "../src/app/globals.css";

// A basic mock context for Clerk
const MockClerkProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ClerkProvider
      publishableKey="pk_test_mock_key"
      initialState={{
        userId: "user_mock123",
        sessionId: "sess_mock123",
        // Add other mock state as required by your components
      }}
    >
      {children}
    </ClerkProvider>
  );
};

const preview: Preview = {
  decorators: [
    (Story) => (
      <MockClerkProvider>
        <Story />
      </MockClerkProvider>
    ),
  ],
  // ... other parameters
};

export default preview;
```

### Mocking specific hooks directly

If a component strongly couples to a Clerk hook, you may also consider abstracting the hook call to a parent container, allowing the presentational component to simply accept user data as props. This makes the component highly testable and easy to document in Storybook without complex mocks.

Example:

```tsx
// Instead of this:
const ProfileCard = () => {
  const { user } = useUser();
  return <div>{user.fullName}</div>;
};

// Do this:
const ProfileCard = ({ user }) => {
  return <div>{user.fullName}</div>;
};
```

This approach is highly recommended for building robust, isolated UI components.

## 4. Running Storybook

To start the Storybook development server, run:

```bash
npm run storybook
```

This will spin up a local server (typically at `http://localhost:6006`) where you can view and interact with your components in isolation.
