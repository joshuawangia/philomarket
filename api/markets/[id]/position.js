import { getAdminServices } from '../../../server/firebaseAdmin.js';
import { handleApiError, methodNotAllowed, requireVerifiedUser, sendJson } from '../../../server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const decoded = await requireVerifiedUser(req);
    const marketId = req.query?.id;
    if (typeof marketId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(marketId)) {
      throw Object.assign(new Error('Market not found.'), { status: 404 });
    }

    const { db } = getAdminServices();
    const marketRef = db.collection('markets').doc(marketId);
    const positionRef = marketRef.collection('positions').doc(decoded.uid);
    const [marketSnapshot, positionSnapshot] = await Promise.all([marketRef.get(), positionRef.get()]);
    if (!marketSnapshot.exists) throw Object.assign(new Error('Market not found.'), { status: 404 });
    const positionData = positionSnapshot.exists ? positionSnapshot.data() : {};
    return sendJson(res, 200, {
      position: positionData.sharesByOutcome || {},
      costBasis: positionData.costBasisByOutcome || {},
    });
  } catch (error) {
    return handleApiError(res, error);
  }
}
