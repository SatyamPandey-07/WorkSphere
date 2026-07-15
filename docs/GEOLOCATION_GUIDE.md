# Leaflet Geolocation Configuration Guide

## Overview

WorkSphere uses the browser's **Geolocation API** to provide location-aware experiences across maps and AI-powered features. Depending on user permissions, the application retrieves the current device location to improve nearby venue discovery, map centering, and contextual recommendations.

When location access is unavailable, the application should gracefully fall back to predefined coordinates instead of blocking the map interface.

---

# Browser Geolocation API

The application requests the user's location using the standard browser API:

```ts
navigator.geolocation.getCurrentPosition(
  successCallback,
  errorCallback,
  options,
);
```

The request is only made when location information is required and should always include proper success and error handling.

### Common Options

| Option               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `enableHighAccuracy` | Requests GPS-quality positioning when available. |
| `timeout`            | Maximum wait time before returning an error.     |
| `maximumAge`         | Allows previously cached locations to be reused. |

Choosing appropriate values depends on the desired balance between accuracy, response time, and battery usage.

---

# Permission Flow

When geolocation is requested, browsers display a permission prompt.

Possible outcomes include:

- ✅ Permission granted
- ❌ Permission denied
- ⏳ Request timed out
- ⚠️ Position unavailable

Applications should always handle every outcome without interrupting the user experience.

# Browser Configuration

## Google Chrome (Desktop & Android)

1. Open the application.
2. Click the **lock icon** beside the website URL.
3. Open **Site Settings**.
4. Ensure **Location** is set to **Allow**.
5. Reload the page.

For Android Chrome:

```
Chrome
→ Settings
→ Site Settings
→ Location
```

Verify that location access is enabled for the website.

---

## Safari (iPhone / iPad)

Enable location services:

```
Settings
→ Privacy & Security
→ Location Services
```

Then allow location access for Safari.

If the application is installed as a Home Screen PWA, verify that location permissions are also granted for the installed application.

Reload the application after changing permission settings.

---

# Debugging Geolocation

Chrome DevTools allows developers to simulate different locations.

Open:

```
Developer Tools
→ More Tools
→ Sensors
```

Available simulations include:

- London
- New York
- Tokyo
- Custom coordinates
- No location

This makes it possible to test permission handling and location-based functionality without physically changing location.

# Fallback Coordinates

If the browser cannot determine the user's location or permission is denied, the application should:

- Continue rendering the Leaflet map.
- Center the map using predefined fallback coordinates.
- Inform the user that live location is unavailable.
- Allow manual interaction with the map.

Using fallback coordinates ensures the mapping experience remains functional even when geolocation cannot be accessed.

---

# Common Issues

## Permission Denied

Possible causes:

- User blocked location access.
- Browser permissions are disabled.
- System-level location services are turned off.

---

## Position Unavailable

Possible causes:

- Weak GPS signal.
- Device cannot determine its position.
- Emulator or virtual device without configured location.

---

## Request Timeout

Possible causes:

- Slow GPS acquisition.
- Poor network conditions.
- High accuracy mode taking longer than expected.

---

# Recommended Testing Workflow

Before submitting changes related to maps:

1. Verify the permission prompt appears.
2. Test both **Allow** and **Block** flows.
3. Confirm fallback coordinates are used correctly.
4. Simulate locations using Chrome DevTools.
5. Ensure no browser console errors are generated.

---

# Related Implementation Files

The current geolocation logic is implemented in:

- `src/app/ai/page.tsx`
- `src/components/VenueSubmissionModal.tsx`
- `src/components/EnhancedChatbot.tsx`

These components use the browser Geolocation API to retrieve the user's location and provide location-aware functionality throughout WorkSphere.

---

# Best Practices

To provide a consistent user experience, follow these recommendations when working with browser geolocation:

- Request location access only when it is needed.
- Always provide an error callback when calling the Geolocation API.
- Avoid repeatedly prompting users after they have denied permission.
- Display a clear message when fallback coordinates are being used.
- Test both success and failure scenarios before submitting changes.
- Ensure location-dependent features continue working even when geolocation is unavailable.

---

# Troubleshooting Checklist

If geolocation is not working as expected, verify the following:

- [ ] The application is served over HTTPS (or `localhost` during development).
- [ ] Browser location permissions are enabled.
- [ ] System location services are turned on.
- [ ] The browser supports the Geolocation API.
- [ ] The browser console does not contain permission or security errors.
- [ ] Fallback coordinates are displayed when permission is denied.
- [ ] The map remains interactive after a failed location request.

---

# References

- MDN Web Docs – Geolocation API
- Chrome DevTools – Sensors Panel
- Leaflet Documentation
