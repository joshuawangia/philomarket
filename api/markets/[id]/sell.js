import { getAdminServices } from '../../../server/firebaseAdmin.js';
import { handleApiError, methodNotAllowed, profileFrom, readJson, requireVerifiedUser, sendJson } from '../../../server/http.js';
import { appendPriceHistory, floorPoints, MARKET_LIQUIDITY, proceedsForSale, roundPoints, roundShares } from '../../../marketMath.js';
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
    const marketId = req.query?.id;
    const outcomeId = typeof body?.outcomeId === 'string' ? body.outcomeId : '';
    if (!validMarketId(marketId)) throw Object.assign(new Error('Market not found.'), { status: 404 });
    if (!outcomeId || outcomeId.length > 80) {
      throw Object.assign(new Error('Choose an outcome before selling it.'), { status: 400 });
    }

    const { db, FieldValue } = getAdminServices();
    const marketRef = db.collection('markets').doc(marketId);
    const positionRef = marketRef.collection('positions').doc(decoded.uid);

    const result = await db.runTransaction(async (transaction) => {
      const account = await readAccountContext(transaction, db, decoded);
      const [marketSnapshot, positionSnapshot] = await Promise.all([
        transaction.get(marketRef),
        transaction.get(positionRef),
      ]);
      if (!marketSnapshot.exists) throw Object.assign(new Error('Market not found.'), { status: 404 });
      if (account.isNew || !positionSnapshot.exists) {
        throw Object.assign(new Error('You do not have a position to sell.'), { status: 409 });
      }

      const userData = account.userData;
      enforceTradeCooldown(userData);
      const marketData = marketSnapshot.data();
      if ((marketData.status || 'open') !== 'open') {
        throw Object.assign(new Error('This market is closed.'), { status: 409 });
      }
      if (!Number.isFinite(userData.points) || userData.points < 0) {
        throw Object.assign(new Error('Your account points are unavailable.'), { status: 409 });
      }

      const outcomes = marketData.outcomes.map((outcome) => ({
        ...outcome,
        shares: Math.max(0, Number(outcome.shares) || 0),
      }));
      const position = positionSnapshot.data().sharesByOutcome || {};
      const liquidity = marketData.liquidity || MARKET_LIQUIDITY;
      const updatedPosition = { ...position };
      const outcomeIndex = outcomes.findIndex((outcome) => outcome.id === outcomeId);
      const soldShares = Number(position[outcomeId]) || 0;
      if (outcomeIndex < 0) throw Object.assign(new Error('That outcome is not in this market.'), { status: 400 });
      if (soldShares <= 0) throw Object.assign(new Error('You do not have a position to sell.'), { status: 409 });
      if (soldShares > outcomes[outcomeIndex].shares + 1e-7) {
        throw Object.assign(new Error('Your position needs a refresh before it can be sold.'), { status: 409 });
      }
      const proceeds = floorPoints(proceedsForSale(outcomes, outcomeIndex, soldShares, liquidity));
      if (proceeds < 0.01) {
        throw Object.assign(new Error('This position is too small to sell for a point amount.'), { status: 409 });
      }
      outcomes[outcomeIndex] = {
        ...outcomes[outcomeIndex],
        shares: Math.max(0, roundShares(outcomes[outcomeIndex].shares - soldShares)),
      };
      updatedPosition[outcomeId] = 0;

      const updatedUser = { ...userData, points: roundPoints(userData.points + proceeds) };
      const updatedMarket = {
        ...marketData,
        outcomes,
        liquidity,
        pointPool: Math.max(0, roundPoints((marketData.pointPool || 0) - proceeds)),
        sellCount: (marketData.sellCount || 0) + 1,
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
        sellCount: updatedMarket.sellCount,
        priceHistory: updatedMarket.priceHistory,
        updatedAt: updatedMarket.updatedAt,
      });
      transaction.set(positionRef, {
        sharesByOutcome: updatedPosition,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        profile: profileFrom(decoded.uid, decoded.email || '', updatedUser),
        market: presentMarket(marketId, updatedMarket, decoded.uid),
        position: updatedPosition,
        proceeds,
        soldShares: roundShares(soldShares),
        outcomeId,
      };
    });

    return sendJson(res, 200, result);
  } catch (error) {
    return handleApiError(res, error);
  }
}
