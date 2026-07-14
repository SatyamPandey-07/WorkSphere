import {
  isValidTelegramWebhookUrl,
  buildTelegramVenueAlert,
} from "../../lib/telegram";

describe("Telegram notifications integration", () => {
  describe("isValidTelegramWebhookUrl", () => {
    it("should accept valid telegram bot sendMessage urls with chat_id", () => {
      const validUrl =
        "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W1u123ew11/sendMessage?chat_id=-100123456789";
      expect(isValidTelegramWebhookUrl(validUrl)).toBe(true);
    });

    it("should reject urls with missing chat_id", () => {
      const invalidUrl =
        "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W1u123ew11/sendMessage";
      expect(isValidTelegramWebhookUrl(invalidUrl)).toBe(false);
    });

    it("should reject urls with incorrect domain or protocol", () => {
      const invalidUrl1 =
        "http://api.telegram.org/bot123456:ABC/sendMessage?chat_id=-100123456789";
      const invalidUrl2 =
        "https://telegram.org/bot123456:ABC/sendMessage?chat_id=-100123456789";
      const invalidUrl3 =
        "https://api.telegram.org/bot123456:ABC/sendPhoto?chat_id=-100123456789";
      expect(isValidTelegramWebhookUrl(invalidUrl1)).toBe(false);
      expect(isValidTelegramWebhookUrl(invalidUrl2)).toBe(false);
      expect(isValidTelegramWebhookUrl(invalidUrl3)).toBe(false);
    });
  });

  describe("buildTelegramVenueAlert", () => {
    it("should format booking event alerts correctly with inline buttons for directions", () => {
      const params = {
        event: "booking" as const,
        userName: "Nomad Scout",
        venueName: "Space Station Cafe",
        address: "123 Outer Space Way",
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const result = buildTelegramVenueAlert(params);

      expect(result.text).toContain("Nomad Scout");
      expect(result.text).toContain("booked a spot at");
      expect(result.text).toContain("Space Station Cafe");
      expect(result.text).toContain("123 Outer Space Way");
      expect(result.text).toContain("37.77490, -122.41940");

      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard?.[0]?.[0]?.text).toContain("Get Directions");
      expect(result.inlineKeyboard?.[0]?.[0]?.url).toContain(
        "destination=37.7749,-122.4194"
      );
    });

    it("should format check-in event alerts correctly without directions if coordinates are missing", () => {
      const params = {
        event: "checkin" as const,
        userName: "Nomad Scout",
        venueName: "Space Station Cafe",
        address: "123 Outer Space Way",
        latitude: null,
        longitude: null,
      };

      const result = buildTelegramVenueAlert(params);

      expect(result.text).toContain("Nomad Scout");
      expect(result.text).toContain("checked in at");
      expect(result.text).toContain("Space Station Cafe");
      expect(result.text).not.toContain("Coordinates:");
      expect(result.inlineKeyboard).toBeUndefined();
    });
  });
});
