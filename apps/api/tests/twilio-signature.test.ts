import { describe, expect, it } from "vitest";
import {
  computeTwilioSignature,
  verifyTwilioSignature,
} from "../src/modules/webhooks/twilio-signature.js";

// The worked example from Twilio's request-validation documentation.
const AUTH_TOKEN = "12345";
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS: Record<string, string> = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675309",
  Digits: "1234",
  From: "+14158675309",
  To: "+18005551212",
};
const DOCUMENTED_SIGNATURE = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

describe("computeTwilioSignature", () => {
  it("reproduces Twilio's documented example signature", () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(DOCUMENTED_SIGNATURE);
  });

  it("is sensitive to every input", () => {
    expect(computeTwilioSignature("other-token", URL, PARAMS)).not.toBe(DOCUMENTED_SIGNATURE);
    expect(computeTwilioSignature(AUTH_TOKEN, `${URL}&x=1`, PARAMS)).not.toBe(DOCUMENTED_SIGNATURE);
    expect(computeTwilioSignature(AUTH_TOKEN, URL, { ...PARAMS, Digits: "9999" })).not.toBe(
      DOCUMENTED_SIGNATURE,
    );
  });
});

describe("verifyTwilioSignature", () => {
  it("accepts the valid signature", () => {
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, PARAMS, DOCUMENTED_SIGNATURE)).toBe(true);
  });

  it("rejects missing, tampered, and wrong-length signatures", () => {
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, PARAMS, undefined)).toBe(false);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, PARAMS, "AAAADt4T1cUTdK1PDd93/VVr8B8=")).toBe(
      false,
    );
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, PARAMS, "short")).toBe(false);
    expect(
      verifyTwilioSignature(
        AUTH_TOKEN,
        URL,
        { ...PARAMS, To: "+10000000000" },
        DOCUMENTED_SIGNATURE,
      ),
    ).toBe(false);
  });
});
