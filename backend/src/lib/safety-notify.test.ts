import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSafetyNotifier, type SosAdminAlert } from "./safety-notify.js";
import { smsSender } from "./sms.js";
import { logger } from "./logger.js";

/**
 * The LIVE ops alert is the safety-critical leg: it must really reach ops, via
 * the SAME env-gated SMS interface (an on-call distribution list) and/or an ops
 * webhook. These prove delivery + masking without a live gateway by spying on
 * the env-gated sender and global fetch.
 */
const alert: SosAdminAlert = {
  userId: "u-1",
  userName: "Asha",
  userPhone: "+919812345678",
  locationText: "https://maps.google.com/?q=12.97,77.59",
  hasLocation: true,
  contactsNotified: 2,
};

const WEBHOOK = "https://hooks.example.com/ops";
const ok = () => new Response(null, { status: 200 });

describe("LiveSafetyNotifier.sosToAdmin (real ops delivery)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("SMSes EVERY ops number via the env-gated sender AND posts the webhook once", async () => {
    const smsSpy = vi.spyOn(smsSender, "sendOpsSos").mockResolvedValue();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());

    await new LiveSafetyNotifier({
      opsSmsNumbers: ["+919800000001", "+919800000002"],
      opsWebhookUrl: WEBHOOK,
    }).sosToAdmin(alert);

    // One SMS per ops number — and ONLY the fields ops needs (who/callback/where).
    expect(smsSpy).toHaveBeenCalledTimes(2);
    expect(smsSpy.mock.calls.map((c) => c[0].toPhone).sort()).toEqual(["+919800000001", "+919800000002"]);
    for (const [params] of smsSpy.mock.calls) {
      expect(params).toEqual({
        toPhone: expect.any(String),
        userName: "Asha",
        userPhone: "+919812345678",
        locationText: alert.locationText,
      });
    }

    // Webhook once, to the configured URL, with the live coords in the payload.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    // Masking: exactly the fields ops needs to act — nothing extra leaks.
    expect(Object.keys(body).sort()).toEqual(
      ["contactsNotified", "event", "hasLocation", "location", "text", "userId", "userName", "userPhone"].sort(),
    );
    expect(body).toMatchObject({ event: "sos.triggered", userPhone: "+919812345678", location: alert.locationText, contactsNotified: 2 });
  });

  it("delivers with only an SMS list, and with only a webhook", async () => {
    const smsSpy = vi.spyOn(smsSender, "sendOpsSos").mockResolvedValue();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());

    await new LiveSafetyNotifier({ opsSmsNumbers: ["+919800000001"] }).sosToAdmin(alert);
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    smsSpy.mockClear();
    fetchSpy.mockClear();

    await new LiveSafetyNotifier({ opsSmsNumbers: [], opsWebhookUrl: WEBHOOK }).sosToAdmin(alert);
    expect(smsSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("is best-effort: one failing ops SMS does not stop the webhook or throw", async () => {
    const smsSpy = vi
      .spyOn(smsSender, "sendOpsSos")
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValue();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());

    await expect(
      new LiveSafetyNotifier({ opsSmsNumbers: ["+919800000001", "+919800000002"], opsWebhookUrl: WEBHOOK }).sosToAdmin(alert),
    ).resolves.toBeUndefined();

    expect(smsSpy).toHaveBeenCalledTimes(2); // the failure did not abort the rest
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("with NO channel configured, sends nothing and logs an error (never throws)", async () => {
    const smsSpy = vi.spyOn(smsSender, "sendOpsSos").mockResolvedValue();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const errSpy = vi.spyOn(logger, "error");

    await expect(new LiveSafetyNotifier({ opsSmsNumbers: [] }).sosToAdmin(alert)).resolves.toBeUndefined();
    expect(smsSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
