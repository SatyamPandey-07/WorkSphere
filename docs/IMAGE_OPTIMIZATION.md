# Next.js Image Optimization Guide

## Overview

In WorkSphere, we use the Next.js `<Image>` component instead of the standard HTML `<img>` tag whenever possible. The Next.js Image component extends the standard `<img>` element with features for automatic image optimization, allowing us to deliver high-performance, responsive images without manual compression or scaling steps.

---

## Benefits

Using the Next.js `Image` component provides several out-of-the-box performance and user experience benefits:

- **Automatic Optimization:** Images are resized, optimized, and served in modern formats like WebP or AVIF automatically.
- **Responsive Image Generation:** The browser receives appropriately sized images based on the user's device viewport.
- **Lazy Loading:** Images are only loaded when they enter the viewport, reducing initial page load times.
- **Bandwidth Reduction:** By serving correctly sized and heavily compressed images, we save significant bandwidth.
- **Improved Core Web Vitals:** Prevents Cumulative Layout Shift (CLS) by enforcing dimensions, and improves Largest Contentful Paint (LCP) via targeted prioritization.

---

## When to use Image

### Recommended Usage

Use `<Image>` for nearly all visual assets:

- **Venue photos:** Essential for displaying high-quality but heavily optimized gallery images.
- **User avatars:** Uploaded profile pictures require responsive sizing and optimization.
- **Organization logos:** Usually vector or raster graphics where crispness at different screen densities is important.
- **Icons:** If using raster icons (though SVG is preferred), `<Image>` can ensure they don't block the render tree.
- **Static assets:** Backgrounds, marketing illustrations, and other local assets in the `public` directory.

### When to use standard `<img>`

A plain `<img>` element may still be appropriate when:

- The image source is dynamic and from a completely unknown external domain that cannot be allowlisted in `next.config.ts`.
- Rendering inline base64 data URLs (e.g., `<img src="data:image/png;base64,..." />`).
- The image is purely decorative and extremely small (e.g., a 10x10 tracker pixel).

---

## Required Props

To prevent Cumulative Layout Shift (CLS), Next.js requires specific sizing props:

- `src`: The source URL or local import of the image.
- `alt`: Descriptive text for screen readers and fallbacks. Must be meaningful.
- `width`: The intrinsic width of the image in pixels (not required if using `fill` or static imports).
- `height`: The intrinsic height of the image in pixels (not required if using `fill` or static imports).

---

## sizes

The `sizes` prop provides the browser with information about how wide the image will be at different breakpoints.

### Why sizes matters

When using the `fill` prop or a responsive layout, Next.js doesn't know how large the image will be on the user's screen. If `sizes` is omitted, Next.js assumes the image will take up `100vw` (the full width of the screen) and downloads a massive image even for a tiny thumbnail.

### Example

```tsx
import Image from "next/image";

// Desktop: 33vw (1/3 of screen)
// Mobile: 100vw (Full width)
<Image
  src="/venue-photo.jpg"
  alt="Coworking space desk"
  fill
  sizes="(max-width: 768px) 100vw, 33vw"
  className="object-cover rounded-lg"
/>;
```

---

## priority

The `priority` prop disables lazy loading and preloads the image immediately.

### When to use priority

- **Hero images:** The main banner at the top of a page.
- **Above-the-fold content:** The first venue card or image visible on the screen without scrolling.
- **LCP Elements:** Any image that is likely to be the Largest Contentful Paint.

### When NOT to use priority

Never use `priority` on images that are below the fold (e.g., footer images, the 10th item in a list). Overusing `priority` will degrade performance by clogging the network with non-critical asset requests.

---

## placeholder="blur"

The `placeholder` prop allows you to show a blurred version of the image while the full-resolution version is loading.

- **Local images:** For static images imported locally, `placeholder="blur"` works automatically because Next.js generates the blur data at build time.
- **Remote images:** For external URLs (like Cloudinary or Unsplash), you must manually provide a base64-encoded `blurDataURL`.

### Limitations

Generating `blurDataURL` for dynamic remote images requires an API call or server-side processing, which can add overhead.

```tsx
<Image
  src="https://res.cloudinary.com/..."
  alt="Profile"
  width={64}
  height={64}
  placeholder="blur"
  blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRg..."
/>
```

---

## Loading Behavior

Next.js handles loading behavior automatically based on the `priority` prop.

- **Lazy loading:** This is the default. The browser will wait to request the image until it is close to entering the viewport.
- **Eager loading:** Images with the `priority` prop are loaded eagerly and immediately.

---

## Remote Images

To protect against malicious image sources, Next.js requires remote domains to be explicitly allowed in the configuration.

### Current Configuration

WorkSphere's `next.config.ts` currently allows the following `remotePatterns`:

```typescript
images: {
  remotePatterns: [
    {
      protocol: "https",
      hostname: "images.unsplash.com",
      pathname: "/**",
    },
    {
      protocol: "https",
      hostname: "source.unsplash.com",
      pathname: "/**",
    },
    {
      protocol: "https",
      hostname: "*.unsplash.com",
      pathname: "/**",
    },
    {
      protocol: "https",
      hostname: "res.cloudinary.com",
      pathname: "/**",
    },
  ],
},
```

### Adding Domains

To add a new external image source (e.g., an AWS S3 bucket), you must add an entry to the `remotePatterns` array in `next.config.ts` and restart the development server.

---

## Accessibility

Images must be accessible to all users.

- **Meaningful alt text:** Describe the content of the image. For a venue photo, use "Modern office space with standing desks" instead of "venue".
- **Decorative images:** If an image is purely decorative and adds no context, use an empty string `alt=""` so screen readers ignore it.

---

## Performance Best Practices

- ✓ **Use correct sizes:** Always provide a `sizes` prop when using `fill`.
- ✓ **Avoid priority everywhere:** Only use `priority` for above-the-fold elements.
- ✓ **Prefer optimized formats:** Let Next.js handle WebP/AVIF conversions automatically.
- ✓ **Avoid oversized images:** Don't render a 4000x4000 image in a 100x100 container.
- ✓ **Cache remote images:** Next.js caches optimized images by default.
- ✓ **Avoid layout shift:** Always provide `width` and `height`, or use `fill` within a relatively positioned container.

---

## Common Mistakes

- ❌ **Missing width/height:** Causes build errors or Cumulative Layout Shift (CLS).
- ❌ **Missing alt:** Fails accessibility audits.
- ❌ **Priority on every image:** Ruins the benefits of lazy loading and slows down the initial page load.
- ❌ **Incorrect sizes:** Specifying `100vw` for a thumbnail forces the user to download a massive file.
- ❌ **Using img instead of Image unnecessarily:** Bypasses all automatic optimization.

---

## Examples

### 1. Avatar

```tsx
import Image from "next/image";

export function UserAvatar({ url, name }: { url: string; name: string }) {
  return (
    <div className="relative w-12 h-12 rounded-full overflow-hidden">
      <Image
        src={url}
        alt={`Profile picture of ${name}`}
        width={48}
        height={48}
        className="object-cover"
      />
    </div>
  );
}
```

### 2. Venue Card

```tsx
import Image from "next/image";

export function VenueCard({
  venue,
  isFirst,
}: {
  venue: any;
  isFirst: boolean;
}) {
  return (
    <div className="relative w-full h-64">
      <Image
        src={venue.imageUrl}
        alt={venue.name}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        priority={isFirst}
        className="object-cover rounded-t-lg"
      />
    </div>
  );
}
```

### 3. Hero Image

```tsx
import Image from "next/image";
import heroImg from "@/public/hero.jpg"; // Local import

export function Hero() {
  return (
    <div className="relative w-full h-[500px]">
      <Image
        src={heroImg}
        alt="People collaborating in a bright coworking space"
        fill
        sizes="100vw"
        priority
        placeholder="blur"
        className="object-cover"
      />
    </div>
  );
}
```

### 4. Small Icon

```tsx
import Image from "next/image";

export function CustomIcon() {
  return (
    <Image
      src="/icons/custom-marker.png"
      alt="" // Decorative
      width={24}
      height={24}
      className="inline-block"
    />
  );
}
```

---

## References

- [Next.js Image Component](https://nextjs.org/docs/app/api-reference/components/image)
- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- [Web Vitals: LCP](https://web.dev/lcp/)
- [Web Vitals: CLS](https://web.dev/cls/)
