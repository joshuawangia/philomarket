export const MARKET_LIQUIDITY = 10000;

export function roundPoints(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function floorPoints(value) {
  return Math.floor((value + 1e-7) * 100) / 100;
}

export function roundShares(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

export function marketProbabilities(outcomes, liquidity = MARKET_LIQUIDITY) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return [];
  const scaled = outcomes.map((outcome) => Math.max(0, Number(outcome.shares) || 0) / liquidity);
  const max = Math.max(...scaled);
  const weights = scaled.map((value) => Math.exp(value - max));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => weight / total);
}

export function appendPriceHistory(history, outcomes, liquidity = MARKET_LIQUIDITY, at = Date.now()) {
  const previous = Array.isArray(history) ? history.slice(-199) : [];
  return [...previous, { at, prices: marketProbabilities(outcomes, liquidity) }];
}

function marketCost(outcomes, liquidity = MARKET_LIQUIDITY) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return 0;
  const scaled = outcomes.map((outcome) => Math.max(0, Number(outcome.shares) || 0) / liquidity);
  const max = Math.max(...scaled);
  return liquidity * (max + Math.log(scaled.reduce((sum, value) => sum + Math.exp(value - max), 0)));
}

export function sharesForSpend(outcomes, outcomeIndex, amount, liquidity = MARKET_LIQUIDITY) {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(liquidity) || liquidity <= 0) return 0;
  if (!Array.isArray(outcomes) || !outcomes[outcomeIndex]) return 0;

  const scaled = outcomes.map((outcome) => Math.max(0, Number(outcome.shares) || 0) / liquidity);
  const max = Math.max(...scaled);
  const logTotal = max + Math.log(scaled.reduce((sum, value) => sum + Math.exp(value - max), 0));
  const logProbability = scaled[outcomeIndex] - logTotal;
  const logSpendIncrement = Math.log(Math.expm1(amount / liquidity));
  const logFactor = logSpendIncrement - logProbability;
  const logOnePlusFactor = logFactor > 36 ? logFactor : Math.log1p(Math.exp(logFactor));
  return roundShares(liquidity * logOnePlusFactor);
}

export function proceedsForSale(outcomes, outcomeIndex, shares, liquidity = MARKET_LIQUIDITY) {
  if (!Number.isFinite(shares) || shares <= 0 || !outcomes[outcomeIndex]) return 0;
  const reduced = outcomes.map((outcome, index) => ({
    ...outcome,
    shares: index === outcomeIndex ? Math.max(0, (Number(outcome.shares) || 0) - shares) : outcome.shares,
  }));
  return Math.max(0, marketCost(outcomes, liquidity) - marketCost(reduced, liquidity));
}
