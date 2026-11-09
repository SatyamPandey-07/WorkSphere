import axios from "axios";

const DEEPL_API_URL = process.env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate";

export interface TranslateParams {
  text: string;
  targetLang: string;
  sourceLang?: string;
}

export async function translateVenueDescription({
  text,
  targetLang,
  sourceLang = "EN",
}: TranslateParams): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;

  if (!apiKey) {
    console.warn("DEEPL_API_KEY is not configured. Returning original text.");
    return text;
  }

  if (!text || text.trim() === "") {
    return "";
  }

  try {
    const response = await axios.post(
      DEEPL_API_URL,
      new URLSearchParams({
        text,
        target_lang: targetLang.toUpperCase(),
        source_lang: sourceLang.toUpperCase(),
      }),
      {
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 8000,
      }
    );

    const translations = response.data?.translations;
    if (translations && translations.length > 0) {
      return translations[0].text;
    }

    return text;
  } catch (error: any) {
    console.error("DeepL Translation Error:", error?.response?.data || error.message);
    throw new Error("Failed to translate venue description via DeepL API");
  }
}