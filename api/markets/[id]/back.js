import { getAdminServices } from '../../../server/firebaseAdmin.js';
import { handleApiError, methodNotAllowed, profileFrom, readJson, requireVerifiedUser, sendJson } from '../../../server/http.js';
import { appendPriceHistory, MARKET_LIQUIDITY, roundPoints, roundShares, sharesForSpend } from '../../../marketMath.js';
import { enforceTradeCooldown, readAccountContext, writeAccountContext } from '../../../server/accounts.js';

function validMarketId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function presentMarket(id, data, currentUid) {
  return {
    id,
    question: data.question,
    outcomes: data.outcomes,
    liquidity: data.liquidity || MARKET_LIQUIDITY,
    pointPool: data.pointPool || 0,
    backCount: data.backCount || 0,
    sellCount: data.sellCount || 0,
    backerCount: data.backerCount || 0,
    status: data.status || 'open',
    isMine: Boolean(currentUid && data.creatorUid === currentUid),
    priceHistory: Array.isArray(data.priceHistory) ? data.priceHistory : [],
    createdAt: data.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const decoded = await requireVerifiedUser(req);
    const body = await readJson(req);
    const rawAmount = Number(body?.amount);
    const amount = roundPoints(rawAmount);
    const outcomeId = typeof body?.outcomeId === 'string' ? body.outcomeId : '';
    if (!Number.isFinite(rawAmount) || rawAmount < 0.01 || Math.abs(rawAmount - amount) > 1e-8) {
      throw Object.assign(new Error('Enter a point amount from 0.01 up to your remaining balance.'), { status: 400 });
    }
    if (!outcomeId || outcomeId.length > 80) {
      throw Object.assign(new Error('Choose an outcome before backing it.'), { status: 400 });
    }

    const { db, FieldValue } = getAdminServices();
    const marketId = req.query?.id;
    if (!validMarketId(marketId)) throw Object.assign(new Error('Market not found.'), { status: 404 });
    const marketRef = db.collection('markets').doc(marketId);
    const positionRef = marketRef.collection('positions').doc(decoded.uid);

    const result = await db.runTransaction(async (transaction) => {
      const account = await readAccountContext(transaction, db, decoded);
      const [marketSnapshot, positionSnapshot] = await Promise.all([
        transaction.get(marketRef),
        transaction.get(positionRef),
      ]);
      if (!marketSnapshot.exists) throw Object.assign(new Error('Market not found.'), { status: 404 });
      const userData = account.userData;
      enforceTradeCooldown(userData);
      const marketData = marketSnapshot.data();
      if ((marketData.status || 'open') !== 'open') {
        throw Object.assign(new Error('This market is closed.'), { status: 409 });
      }
      if (!Number.isFinite(userData.points) || userData.points + 1e-8 < amount) {
        throw Object.assign(new Error('You do not have enough points for that pick.'), { status: 409 });
      }

      const outcomes = marketData.outcomes.map((outcome) => ({
        ...outcome,
        shares: Math.max(0, Number(outcome.shares) || 0),
      }));
      const outcomeIndex = outcomes.findIndex((outcome) => outcome.id === outcomeId);
      if (outcomeIndex < 0) throw Object.assign(new Error('That outcome is not in this market.'), { status: 400 });

      const liquidity = marketData.liquidity || MARKET_LIQUIDITY;
      const sharesBought = sharesForSpend(outcomes, outcomeIndex, amount, liquidity);
      if (!Number.isFinite(sharesBought) || sharesBought <= 0) {
        throw Object.assign(new Error('The current market quote is unavailable. Refresh and try again.'), { status: 409 });
      }
      outcomes[outcomeIndex] = { ...outcomes[outcomeIndex], shares: roundShares(outcomes[outcomeIndex].shares + sharesBought) };
      const positionData = positionSnapshot.exists ? positionSnapshot.data() : {};
      const existingPosition = positionData.sharesByOutcome || {};
      const position = {
        ...existingPosition,
        [outcomeId]: roundShares((Number(existingPosition[outcomeId]) || 0) + sharesBought),
      };
      const existingCostBasis = positionData.costBasisByOutcome || {};
      const priorCostBasis = existingCostBasis[outcomeId];
      const hasKnownBasis = typeof priorCostBasis === 'number' && Number.isFinite(priorCostBasis) && priorCostBasis >= 0;
      const costBasis = {
        ...existingCostBasis,
        [outcomeId]: Number(existingPosition[outcomeId]) > 0 && !hasKnownBasis
          ? null
          : roundPoints((hasKnownBasis ? priorCostBasis : 0) + amount),
      };
      const hasBackedBefore = positionSnapshot.exists && positionSnapshot.data().hasBacked === true;
      const updatedUser = { ...userData, points: roundPoints(userData.points - amount) };
      const updatedMarket = {
        ...marketData,
        outcomes,
        liquidity,
        pointPool: roundPoints((marketData.pointPool || 0) + amount),
        backCount: (marketData.backCount || 0) + 1,
        backerCount: (marketData.backerCount || 0) + (hasBackedBefore ? 0 : 1),
        priceHistory: appendPriceHistory(marketData.priceHistory, outcomes, liquidity),
        updatedAt: FieldValue.serverTimestamp(),
      };

      writeAccountContext(transaction, account, FieldValue, {
        points: updatedUser.points,
        lastTradeAt: FieldValue.serverTimestamp(),
      });
      transaction.update(marketRef, {
        outcomes,
        liquidity,
        pointPool: updatedMarket.pointPool,
        backCount: updatedMarket.backCount,
        backerCount: updatedMarket.backerCount,
        priceHistory: updatedMarket.priceHistory,
        updatedAt: updatedMarket.updatedAt,
      });
      transaction.set(positionRef, {
        uid: decoded.uid,
        sharesByOutcome: position,
        costBasisByOutcome: costBasis,
        hasBacked: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        profile: profileFrom(decoded.uid, decoded.email || '', updatedUser),
        market: presentMarket(marketId, updatedMarket, decoded.uid),
        position,
        costBasis,
      };
    });

    return sendJson(res, 200, result);
  } catch (error) {
    return handleApiError(res, error);
  }
}
