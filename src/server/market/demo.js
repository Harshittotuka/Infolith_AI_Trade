const BASE_PRICES = new Map([
  ["NSE_INDEX|Nifty 50", 25250],
  ["NSE_INDEX|Nifty Bank", 56500],
  ["BSE_INDEX|SENSEX", 82800],
  ["NSE_EQ|INE002A01018", 2960],
  ["NSE_EQ|INE062A01020", 835],
  ["NSE_EQ|INE467B01029", 3910],
  ["NSE_EQ|INE040A01034", 1690],
  ["NSE_EQ|INE090A01021", 1215],
  ["NSE_EQ|INE009A01021", 1490],
  ["NSE:NIFTY 50", 25250],
  ["NSE:NIFTY BANK", 56500],
  ["NSE:NIFTY FIN SERVICE", 26200],
  ["NSE:NIFTY IT", 36500],
  ["BSE:SENSEX", 82800],
  ["BSE:BANKEX", 64000],
  ["NSE:RELIANCE", 2960],
  ["NSE:TCS", 3910],
  ["NSE:HDFCBANK", 1690],
  ["NSE:ICICIBANK", 1215],
  ["NSE:INFY", 1490],
  ["NSE:SBIN", 835],
  ["NSE:BHARTIARTL", 1420],
  ["NSE:ITC", 435],
  ["NSE:LT", 3620],
  ["NSE:AXISBANK", 1180],
  ["NSE:KOTAKBANK", 1780],
  ["NSE:MARUTI", 12600],
  ["NSE:TATAMOTORS", 950],
  ["NSE:ADANIENT", 3150],
  ["NSE:HINDUNILVR", 2510],
  ["NSE:ASIANPAINT", 2860]
]);

function fallbackPrice(instrument) {
  let hash = 0;
  for (const char of instrument) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return 250 + (hash % 5000);
}

export function createDemoProvider() {
  const state = new Map();

  function getState(instrument) {
    if (!state.has(instrument)) {
      const base = BASE_PRICES.get(instrument) || fallbackPrice(instrument);
      state.set(instrument, {
        price: base,
        close: base * (0.995 + Math.random() * 0.01),
        high: base,
        low: base
      });
    }
    return state.get(instrument);
  }

  return {
    name: "demo",
    async getQuotes(instruments) {
      return instruments.map((instrument) => {
        const current = getState(instrument);
        const volatility = current.price > 10000 ? 0.0007 : 0.0016;
        const drift = (Math.random() - 0.48) * current.price * volatility;
        current.price = Math.max(1, current.price + drift);
        current.high = Math.max(current.high, current.price);
        current.low = Math.min(current.low, current.price);

        const change = current.price - current.close;
        return {
          instrument,
          last_price: Number(current.price.toFixed(2)),
          change: Number(change.toFixed(2)),
          percent_change: Number(((change / current.close) * 100).toFixed(2)),
          volume: Math.floor(100000 + Math.random() * 5000000),
          oi: Math.floor(10000 + Math.random() * 300000),
          ohlc: {
            open: Number((current.close * 1.001).toFixed(2)),
            high: Number(current.high.toFixed(2)),
            low: Number(current.low.toFixed(2)),
            close: Number(current.close.toFixed(2))
          },
          source: "demo",
          timestamp: new Date().toISOString()
        };
      });
    },
    async status() {
      return {
        provider: "demo",
        configured: true,
        connected: true,
        mode: "Simulated prices"
      };
    }
  };
}
