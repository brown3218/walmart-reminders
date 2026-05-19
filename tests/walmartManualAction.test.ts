import { describe, expect, it } from "vitest";
import { detectWalmartManualAction, walmartManualActionMessage } from "../src/walmart/manualAction.js";

describe("Walmart manual action detection", () => {
  it("detects login, 2FA, robot, CAPTCHA, and press-and-hold challenges", () => {
    const challengeTexts = [
      "Sign in to your Walmart account",
      "Enter the verification code we sent",
      "Press and hold to confirm you are not a robot",
      "Complete the CAPTCHA",
      "Security check required",
      "Two-step verification"
    ];

    for (const text of challengeTexts) {
      expect(detectWalmartManualAction(text)).toBe(true);
    }
  });

  it("uses a consistent manual-action message per automation area", () => {
    expect(walmartManualActionMessage("catalog")).toContain("catalog sync");
    expect(walmartManualActionMessage("cart_add")).toContain("add to cart");
  });
});
