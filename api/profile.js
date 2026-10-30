import { getAdminServices } from '../server/firebaseAdmin.js';
import { handleApiError, methodNotAllowed, profileFrom, requireVerifiedUser, sendJson } from '../server/http.js';
import { readAccountContext, writeAccountContext } from '../server/accounts.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const decoded = await requireVerifiedUser(req);
    const { db, FieldValue } = getAdminServices();
    const profile = await db.runTransaction(async (transaction) => {
      const account = await readAccountContext(transaction, db, decoded);
      writeAccountContext(transaction, account, FieldValue);
      return profileFrom(decoded.uid, decoded.email || '', account.userData);
    });
    return sendJson(res, 200, { profile });
  } catch (error) {
    return handleApiError(res, error);
  }
}
