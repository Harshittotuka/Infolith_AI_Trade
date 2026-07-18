import { createDemoProvider } from "./demo.js";
import { createUpstoxProvider } from "./upstox.js";

export function createMarketProvider({ store }) {
  const demo = createDemoProvider();
  const upstox = createUpstoxProvider({ store });
  const providerName = String(process.env.MARKET_PROVIDER || "demo").toLowerCase();
  const active = providerName === "upstox" ? upstox : demo;

  return {
    name: active.name,
    isLive: providerName === "upstox",
    upstox,
    async getQuotes(instruments) {
      return active.getQuotes(instruments);
    },
    async status() {
      const status = await active.status();
      return {
        ...status,
        requestedProvider: providerName
      };
    }
  };
}
