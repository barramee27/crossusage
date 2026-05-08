import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDevMockProviderCredentials,
  isProviderAccountDevMockEnvEnabled,
  shouldApplyProviderAccountDevMock,
} from "./provider-account-dev-mock";

describe("buildDevMockProviderCredentials", () => {
  it("returns stable mock fields for a label", () => {
    expect(buildDevMockProviderCredentials("Work")).toEqual({
      label: "Work",
      accessToken: "crossusage-dev-mock-access-token",
      refreshToken: "crossusage-dev-mock-refresh-token",
      sessionKey: "crossusage-dev-mock-session:Work",
    });
  });

  it("uses Account when label is blank", () => {
    const out = buildDevMockProviderCredentials("   ");
    expect(out.label).toBe("Account");
    expect(out.sessionKey).toBe("crossusage-dev-mock-session:Account");
  });
});

describe("isProviderAccountDevMockEnvEnabled", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PROVIDER_ACCOUNT_DEV_MOCK", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when empty or not a yes token", () => {
    vi.stubEnv("VITE_PROVIDER_ACCOUNT_DEV_MOCK", "");
    expect(isProviderAccountDevMockEnvEnabled()).toBe(false);
    vi.stubEnv("VITE_PROVIDER_ACCOUNT_DEV_MOCK", "0");
    expect(isProviderAccountDevMockEnvEnabled()).toBe(false);
    vi.stubEnv("VITE_PROVIDER_ACCOUNT_DEV_MOCK", "false");
    expect(isProviderAccountDevMockEnvEnabled()).toBe(false);
  });

  it("is true for 1, true, or yes (trimmed, case-insensitive)", () => {
    for (const value of ["1", " true ", "YES", "True"]) {
      vi.stubEnv("VITE_PROVIDER_ACCOUNT_DEV_MOCK", value);
      expect(isProviderAccountDevMockEnvEnabled()).toBe(true);
    }
  });
});

describe("shouldApplyProviderAccountDevMock", () => {
  it("is false under Vitest (MODE is not development)", () => {
    expect(shouldApplyProviderAccountDevMock()).toBe(false);
  });
});
