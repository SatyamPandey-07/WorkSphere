import {
  registerApplePassDevice,
  unregisterApplePassDevice,
  getRegisteredDevicesForPass,
  sendApplePassUpdatePushNotification,
  notifyAppleWalletOnBookingUpdate,
} from "@/lib/wallet/passService";

describe("Apple Wallet Pass APNs Web Service & Notification Handler", () => {
  const mockDevice1 = {
    deviceLibraryIdentifier: "device_lib_abc123",
    passTypeIdentifier: "pass.com.worksphere.booking",
    serialNumber: "booking-bk-9001",
    pushToken: "apns_token_778899aabbcc",
    authorizationToken: "auth_token_secret_xyz",
    bookingId: "bk-9001",
  };

  const mockDevice2 = {
    deviceLibraryIdentifier: "device_lib_def456",
    passTypeIdentifier: "pass.com.worksphere.booking",
    serialNumber: "booking-bk-9001",
    pushToken: "apns_token_112233ddeeff",
    authorizationToken: "auth_token_secret_xyz",
    bookingId: "bk-9001",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Device Push Token Registration", () => {
    it("successfully registers a new device push token for a pass", async () => {
      const result = await registerApplePassDevice(mockDevice1);
      expect(result.status).toBe("created");

      const registered = await getRegisteredDevicesForPass(
        mockDevice1.passTypeIdentifier,
        mockDevice1.serialNumber
      );
      expect(registered).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceLibraryIdentifier: mockDevice1.deviceLibraryIdentifier,
            pushToken: mockDevice1.pushToken,
          }),
        ])
      );
    });

    it("updates existing registration when device re-registers with same credentials", async () => {
      await registerApplePassDevice(mockDevice1);
      const duplicateResult = await registerApplePassDevice({
        ...mockDevice1,
        pushToken: "new_apns_token_updated",
      });

      expect(duplicateResult.status).toBe("already_registered");
      const registered = await getRegisteredDevicesForPass(
        mockDevice1.passTypeIdentifier,
        mockDevice1.serialNumber
      );
      expect(registered).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceLibraryIdentifier: mockDevice1.deviceLibraryIdentifier,
            pushToken: "new_apns_token_updated",
          }),
        ])
      );
    });

    it("throws an error if required parameters are missing during registration", async () => {
      await expect(
        registerApplePassDevice({
          deviceLibraryIdentifier: "",
          passTypeIdentifier: "pass.com.worksphere.booking",
          serialNumber: "booking-1",
          pushToken: "token",
          authorizationToken: "auth",
        })
      ).rejects.toThrow("Missing required registration parameters");
    });
  });

  describe("Pass Deletion & Unregistration", () => {
    it("successfully unregisters device when pass is deleted", async () => {
      await registerApplePassDevice(mockDevice2);

      const unregResult = await unregisterApplePassDevice({
        deviceLibraryIdentifier: mockDevice2.deviceLibraryIdentifier,
        passTypeIdentifier: mockDevice2.passTypeIdentifier,
        serialNumber: mockDevice2.serialNumber,
        authorizationToken: mockDevice2.authorizationToken,
      });

      expect(unregResult.status).toBe("unregistered");
    });

    it("refuses unregistration if authorization token does not match", async () => {
      await registerApplePassDevice(mockDevice1);

      const unregResult = await unregisterApplePassDevice({
        deviceLibraryIdentifier: mockDevice1.deviceLibraryIdentifier,
        passTypeIdentifier: mockDevice1.passTypeIdentifier,
        serialNumber: mockDevice1.serialNumber,
        authorizationToken: "wrong_unauthorized_token",
      });

      expect(unregResult.status).toBe("unauthorized");
    });

    it("returns not_found when unregistering an unknown device", async () => {
      const unregResult = await unregisterApplePassDevice({
        deviceLibraryIdentifier: "non_existent_device",
        passTypeIdentifier: "pass.com.worksphere.booking",
        serialNumber: "unknown",
        authorizationToken: "token",
      });

      expect(unregResult.status).toBe("not_found");
    });
  });

  describe("APNs Push Notification Trigger on Booking Updates", () => {
    it("sends silent push notification when booking is modified", async () => {
      await registerApplePassDevice(mockDevice1);

      const pushResults = await notifyAppleWalletOnBookingUpdate({
        bookingId: "bk-9001",
        event: "modified",
      });

      expect(pushResults.length).toBeGreaterThan(0);
      expect(pushResults[0]).toEqual(
        expect.objectContaining({
          deviceLibraryIdentifier: mockDevice1.deviceLibraryIdentifier,
          success: true,
          status: 200,
        })
      );
    });

    it("sends silent push notification when booking is checked in", async () => {
      await registerApplePassDevice(mockDevice1);

      const pushResults = await notifyAppleWalletOnBookingUpdate({
        bookingId: "bk-9001",
        event: "checked_in",
      });

      expect(pushResults.length).toBeGreaterThan(0);
      expect(pushResults[0].success).toBe(true);
    });

    it("sends silent push notification when booking is cancelled", async () => {
      await registerApplePassDevice(mockDevice1);

      const pushResults = await notifyAppleWalletOnBookingUpdate({
        bookingId: "bk-9001",
        event: "cancelled",
      });

      expect(pushResults.length).toBeGreaterThan(0);
      expect(pushResults[0].success).toBe(true);
    });

    it("sends silent push notification when pass is expired", async () => {
      await registerApplePassDevice(mockDevice1);

      const pushResults = await notifyAppleWalletOnBookingUpdate({
        bookingId: "bk-9001",
        event: "expired",
      });

      expect(pushResults.length).toBeGreaterThan(0);
      expect(pushResults[0].success).toBe(true);
    });

    it("broadcasts notifications to all registered devices for the same pass", async () => {
      await registerApplePassDevice(mockDevice1);
      await registerApplePassDevice(mockDevice2);

      const pushResults = await sendApplePassUpdatePushNotification({
        passTypeIdentifier: "pass.com.worksphere.booking",
        serialNumber: "booking-bk-9001",
        bookingId: "bk-9001",
        event: "modified",
      });

      expect(pushResults).toHaveLength(2);
      expect(pushResults.every((r) => r.success)).toBe(true);
    });

    it("handles passes with no registered devices gracefully", async () => {
      const pushResults = await sendApplePassUpdatePushNotification({
        passTypeIdentifier: "pass.com.worksphere.booking",
        serialNumber: "booking-ghost-pass",
        bookingId: "ghost",
        event: "cancelled",
      });

      expect(pushResults).toHaveLength(0);
    });
  });
});
