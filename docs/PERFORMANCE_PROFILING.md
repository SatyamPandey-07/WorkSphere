# React Performance Profiling Guide

This guide explains how to profile React applications using the React DevTools Profiler to identify slow-rendering components and optimize them.

---

## Prerequisites

- React application running in development mode.
- React DevTools installed in your browser.

---

## Opening the Profiler

1. Open your React application.
2. Open the browser Developer Tools.
3. Select the **React** tab.
4. Click **Profiler**.

---

## Recording a Profiling Session

1. Open the **Profiler** tab.
2. Click the **Record** button.
3. Interact with your application.
4. Stop recording.

React DevTools will display all component renders captured during the session.

---

## Reading the Flame Graph

The Flame Graph helps identify expensive renders.

- Wider bars indicate longer render times.
- Narrow bars render quickly.
- Components highlighted with larger render durations are good optimization candidates.

You can click any component to inspect:

- Render duration
- Why it rendered
- Component hierarchy

---

## Using the Ranked View

The Ranked view sorts components by render cost.

This makes it easier to locate components consuming the most rendering time.

---

## Optimizing with React.memo

If a component receives the same props frequently, unnecessary re-renders can be avoided using `React.memo`.

Example:

```jsx
const UserCard = React.memo(function UserCard({ user }) {
  return <div>{user.name}</div>;
});
```

React will reuse the previous render when the props have not changed.

---

## Best Practices

- Profile before optimizing.
- Focus on components with the highest render cost.
- Use `React.memo` only when unnecessary renders are measurable.
- Avoid premature optimization.

---

## Summary

The React DevTools Profiler helps identify rendering bottlenecks through Flame Graphs and Ranked views. After identifying expensive components, techniques such as `React.memo` can reduce unnecessary renders and improve application performance.
