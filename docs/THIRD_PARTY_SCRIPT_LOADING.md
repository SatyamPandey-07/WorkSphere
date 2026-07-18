# Safely Loading Third-Party Scripts in Next.js
Third-party scripts (such as analytics, chat widgets, and ads) can significantly impact web performance and degrade Core Web Vitals if not loaded carefully. Next.js provides a built-in `next/script` component to optimize how and when these scripts are loaded.
## The Next.js `<Script>` Component
The `<Script>` component is an extension of the HTML `<script>` element. It allows developers to set the loading priority of third-party scripts anywhere in the application without blocking the main thread.
### Basic Usage
```jsx
import Script from 'next/script';
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="[https://example.com/script.js](https://example.com/script.js)" strategy="lazyOnload"/>
      </body>
    </html>
  );
}