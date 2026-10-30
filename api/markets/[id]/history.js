import { getAdminServices } from '../../../server/firebaseAdmin.js';
import { handleApiError, methodNotAllowed, sendJson } from '../../../server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const marketId = req.query?.id;
    if (typeof marketId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(marketId)) {
      throw Object.assign(new Error('Market not found.'), { status: 404 });
    }
    const { db } = getAdminServices();
    const snapshot = await db.collection('markets').doc(marketId).get();
    if (!snapshot.exists) throw Object.assign(new Error('Market not found.'), { status: 404 });
    const history = snapshot.data().priceHistory;
    return sendJson(res, 200, { priceHistory: Array.isArray(history) ? history : [] }, {
      cacheControl: 'public, s-maxage=10, stale-while-revalidate=30',
    });
  } catch (error) {
    return handleApiError(res, error);
  }
}
