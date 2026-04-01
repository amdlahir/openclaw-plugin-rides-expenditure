import type { Provider } from "./types";

export const PROVIDERS: Record<
  Provider,
  { name: string; email: string; color: string }
> = {
  grab: {
    name: "Grab",
    email: "no-reply@grab.com",
    color: "#00B14F",
  },
  gojek: {
    name: "Gojek",
    email: "no-reply@invoicing.gojek.com",
    color: "#00AA13",
  },
};

export const SUPPORTED_CURRENCIES = ["SGD", "USD", "MYR"] as const;
export const DEFAULT_CURRENCY = "SGD";
export const DEFAULT_CATEGORY = "personal";
export const DEFAULT_ALERT_THRESHOLD = 0.8;
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
