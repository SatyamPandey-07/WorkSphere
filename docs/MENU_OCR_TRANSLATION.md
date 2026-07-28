# Menu OCR Translation

## Overview

WorkSphere provides a menu translation feature that extracts text from menu images using **Tesseract.js** and translates the extracted content through the `/api/menu-translate` API.

The OCR workflow is implemented in `src/components/chat/VenueDetailDialog.tsx`, while the translation endpoint is implemented in `src/app/api/menu-translate/route.ts`.

---

## Architecture

```
User uploads menu photo
        │
        ▼
VenueDetailDialog.tsx
        │
        ▼
Tesseract.js OCR
        │
        ▼
Extracted menu text
        │
        ▼
/api/menu-translate
        │
        ▼
Google Translate API
        │
        ▼
Translated menu

---

## OCR Workflow

The OCR process is handled inside:

```
src/components/chat/VenueDetailDialog.tsx
```

When a user selects a menu image and chooses a target language, the application follows these steps:

1. Checks whether OCR text already exists in the cache.
2. If no cached text is available, Tesseract.js processes the uploaded image.
3. Extracted text is cleaned using `trim()`.
4. The OCR result is stored for future requests.
5. The extracted menu text is sent to the translation API.

The OCR extraction uses Tesseract.js:

```ts
const {
  data: { text },
} = await Tesseract.recognize(previewPhoto, "eng");
```

The current implementation recognizes English (`eng`) text from menu images.
---

## OCR Caching

To improve performance, the extracted OCR text is stored in a local cache.

The implementation maintains:

- `ocrCache` — stores extracted text for previously processed menu images.
- `translationCache` — stores translated results for previously requested languages.

Benefits:

- Avoids running OCR repeatedly on the same image.
- Reduces unnecessary API requests.
- Provides faster responses when users request the same translation again.

The cache key for translations is generated using:

```
image + target language
```

This allows multiple translations of the same menu image to be stored separately.
---

## Translation API

The translation workflow is handled by the API route:

```
src/app/api/menu-translate/route.ts
```

The frontend sends the extracted menu text and selected target language through a POST request:

```ts
fetch("/api/menu-translate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: extractedText,
    targetLanguage: lang,
  }),
});
```

The API performs the following steps:

1. Authenticates the user using Clerk.
2. Validates the received text and target language.
3. Maps supported language names to language codes.
4. Sends the text to the Google Translate endpoint.
5. Returns the translated text as a JSON response.

Example response:

```json
{
  "translatedText": "Translated menu content"
}
```

---

## Supported Languages

The current implementation supports:

| Language | Code |
|----------|------|
| English  | en   |
| Hindi    | hi   |
| French   | fr   |
| German   | de   |
| Spanish  | es   |

Additional languages can be supported by extending the language mapping inside the API route.
---

## Error Handling

The menu translation workflow handles common failures and displays appropriate messages.

Handled cases include:

- **OCR failure**
  - Displayed when Tesseract.js cannot extract text from the image.

- **No readable text found**
  - Displayed when the OCR result is empty.

- **Translation failure**
  - Displayed when the translation API request fails.

- **Unauthorized access**
  - The translation API returns an authentication error when the user is not logged in.

---

## Manual Testing

To test the menu OCR translation feature:

1. Start the development server:

```bash
npm run dev
```

2. Open a venue that contains a menu image.

3. Select a target language for translation.

4. Verify that:

- Menu text is extracted successfully from the image.
- The translated result appears correctly.
- Repeating the same translation uses cached results.
- Invalid or unreadable images show an error message.

---

## Implementation Notes

The current implementation performs OCR directly on the uploaded image using Tesseract.js.

Image preprocessing techniques such as grayscale conversion and thresholding are not currently implemented.

Dietary tag extraction is also not part of the current implementation.