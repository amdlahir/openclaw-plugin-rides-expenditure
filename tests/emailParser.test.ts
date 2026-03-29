import { describe, it, expect } from "vitest";
import { parseGrabReceipt, parseGojekReceipt } from "../src/parsers/emailParser";

describe("parseGrabReceipt", () => {
  const internalDate = "1711929600000"; // 2024-04-01

  it("extracts amount and locations from SGD receipt", () => {
    const body = "Grab E-Receipt\nTotal Paid\nSGD 15.50\nYour Trip\n2.5 km \n143 Pasir Ris Grove\n9:34PM\nBugis Junction\n9:50PM\nGrab Singapore";
    const result = parseGrabReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1550);
    expect(result!.currency).toBe("SGD");
    expect(result!.pickup).toBe("143 Pasir Ris Grove");
    expect(result!.dropoff).toBe("Bugis Junction");
  });

  it("extracts amount from MYR receipt", () => {
    const body = "Grab E-Receipt\nTotal Paid\nRM12.50\nYour Trip\n5.0 km\nKLCC Tower\n2:00PM\nBukit Bintang Plaza\n2:20PM";
    const result = parseGrabReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1250);
    expect(result!.currency).toBe("MYR");
    expect(result!.pickup).toBe("KLCC Tower");
    expect(result!.dropoff).toBe("Bukit Bintang Plaza");
  });

  it("extracts amount with SGD prefix", () => {
    const body = "Grab receipt\nFare: SGD 8.00";
    const result = parseGrabReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(800);
    expect(result!.currency).toBe("SGD");
  });

  it("returns null for non-Grab email", () => {
    const body = "Your Gojek trip receipt\nTotal: S$15.50";
    expect(parseGrabReceipt(body, internalDate)).toBeNull();
  });

  it("returns null when no amount found", () => {
    const body = "Your Grab trip was completed. Thank you!";
    expect(parseGrabReceipt(body, internalDate)).toBeNull();
  });

  it("returns null for non-receipt Grab email", () => {
    const body = "Grab promo: Use code SAVE50 for your next ride!";
    expect(parseGrabReceipt(body, internalDate)).toBeNull();
  });

  it("uses internalDate as ride date", () => {
    const body = "Your Grab trip receipt\nTotal: S$10.00";
    const result = parseGrabReceipt(body, internalDate);

    expect(result!.date).toBe(1711929600000);
  });

  it("calculates confidence based on extracted fields", () => {
    // With locations: base 0.5 + amount 0.2 + pickup 0.1 + dropoff 0.1 = 0.9
    const full = "Grab receipt\nTotal: S$10.00\nYour Trip\n2.5 km\nOrchard Road\n9:00PM\nBugis Street\n9:15PM";
    const fullResult = parseGrabReceipt(full, internalDate);
    expect(fullResult!.confidence).toBeCloseTo(0.9);

    // Only amount: base 0.5 + amount 0.2 = 0.7
    const amountOnly = "Grab receipt\nTotal: S$10.00";
    const amountResult = parseGrabReceipt(amountOnly, internalDate);
    expect(amountResult!.confidence).toBe(0.7);
  });
});

describe("parseGojekReceipt", () => {
  const internalDate = "1711929600000";

  it("extracts amount from SGD receipt", () => {
    const body = "Gojek trip receipt\nFare: S$8.50\nFrom: Marina Bay Sands\nDestination: Bugis Junction";
    const result = parseGojekReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(850);
    expect(result!.currency).toBe("SGD");
    expect(result!.pickup).toBe("Marina Bay Sands");
    expect(result!.dropoff).toBe("Bugis Junction");
  });

  it("recognizes GoRide receipt", () => {
    const body = "GoRide trip fare receipt\nTotal: $12.00";
    const result = parseGojekReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1200);
  });

  it("recognizes GoCar receipt", () => {
    const body = "GoCar trip receipt\nTotal: S$20.00";
    const result = parseGojekReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2000);
  });

  it("returns null for non-Gojek email", () => {
    const body = "Your Grab trip receipt\nTotal: S$15.50";
    expect(parseGojekReceipt(body, internalDate)).toBeNull();
  });

  it("returns null when no amount found", () => {
    const body = "Your Gojek trip was completed. Thank you!";
    expect(parseGojekReceipt(body, internalDate)).toBeNull();
  });

  it("extracts Indonesian pickup/dropoff patterns", () => {
    const body = "Gojek trip receipt\nTotal: S$10.00\nPenjemputan: Jalan Sudirman\nTujuan: Grand Indonesia";
    const result = parseGojekReceipt(body, internalDate);

    expect(result).not.toBeNull();
    expect(result!.pickup).toBe("Jalan Sudirman");
    expect(result!.dropoff).toBe("Grand Indonesia");
  });
});
