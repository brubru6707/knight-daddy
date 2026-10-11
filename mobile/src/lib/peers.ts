// Static reference data (names and peers), not market data. Matches the web app (terminal/frontend/src/ui.jsx).
export const PEERS: Record<string, string[]> = {
  NVDA: ["AMD", "INTC", "TSM"],
  AAPL: ["MSFT", "GOOGL", "AMZN"],
  TSLA: ["RIVN", "LCID", "F"],
  DDOG: ["SNOW", "MDB", "DT"],
  AMZN: ["WMT", "MSFT", "GOOGL"],
  CELH: ["MNST", "KDP", "PEP"],
  SMCI: ["DELL", "HPE", "NVDA"],
  AMD: ["NVDA", "INTC", "QCOM"],
  MSFT: ["AAPL", "GOOGL", "AMZN"],
};

export const NAMES: Record<string, string> = {
  NVDA: "NVIDIA Corporation", DDOG: "Datadog, Inc.", AAPL: "Apple Inc.", TSLA: "Tesla, Inc.", MSFT: "Microsoft Corporation",
  AMZN: "Amazon.com, Inc.", CELH: "Celsius Holdings, Inc.", SMCI: "Super Micro Computer, Inc.", AMD: "Advanced Micro Devices, Inc.",
  INTC: "Intel Corporation", TSM: "Taiwan Semiconductor", GOOGL: "Alphabet Inc.", RIVN: "Rivian Automotive, Inc.",
  LCID: "Lucid Group, Inc.", F: "Ford Motor Company", SNOW: "Snowflake Inc.", MDB: "MongoDB, Inc.", DT: "Dynatrace, Inc.",
  MNST: "Monster Beverage Corporation", KDP: "Keurig Dr Pepper Inc.", PEP: "PepsiCo, Inc.", DELL: "Dell Technologies Inc.",
  HPE: "Hewlett Packard Enterprise", QCOM: "Qualcomm Incorporated", WMT: "Walmart Inc.",
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
};

// Home list: stocks the Oscar worker pushes live data for. Stocks only; crypto stays out of the app.
export const HOME = ["AAPL", "MSFT", "TSLA", "AMZN", "NVDA", "DDOG"];

// Crypto rows are display only: price and untagged headlines (model=none), never a model output or fine-tune.
export const CRYPTO = ["BTC-USD", "ETH-USD", "SOL-USD"];
export const isCrypto = (t: string) => CRYPTO.includes(t);
export const short = (t: string) => t.replace(/-USD$/, "");

// Onboarding groups: our supported tickers only. Grouping organizes the user's own choices; it never suggests picks.
export const CATEGORIES = [
  { name: "Chips", tickers: ["NVDA"] },
  { name: "Software and cloud", tickers: ["MSFT", "DDOG"] },
  { name: "Consumer tech and retail", tickers: ["AAPL", "AMZN"] },
  { name: "Cars", tickers: ["TSLA"] },
  { name: "Crypto", tickers: CRYPTO },
];
export const SUPPORTED = [...HOME, ...CRYPTO];
