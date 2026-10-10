// Hardcoded competitor map (documented in mobile/API.md).
export const PEERS: Record<string, string[]> = {
  NVDA: ["AMD", "INTC", "TSM"],
  AAPL: ["MSFT", "GOOGL", "AMZN"],
  TSLA: ["RIVN", "LCID", "F"],
  DDOG: ["SNOW", "NET", "DT"],
  CELH: ["MNST", "KDP", "PEP"],
  SMCI: ["DELL", "HPE", "NVDA"],
  AMD: ["NVDA", "INTC", "QCOM"],
  MSFT: ["AAPL", "GOOGL", "AMZN"],
};
