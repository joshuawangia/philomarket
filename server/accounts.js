import { createHash } from 'node:crypto';

export const STARTING_POINTS = 500;
export const TRADE_COOLDOWN_MS = 2_000;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function emailBindingRef(db, email) {
  const key = createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return db.collection('accountEmails').doc(key);
}

// Read this before any transaction writes. A permanent email binding prevents
// deleting and recreating the Firebase identity to claim another 500 points.
export async function readAccountContext(transaction, db, decoded) {
  const email = normalizeEmail(decoded.email);
  if (!decoded.uid || !email) {
    throw Object.assign(new Error('A verified email account is required.'), { status: 403 });
  }

  const userRef = db.collection('users').doc(decoded.uid);
  const emailRef = emailBindingRef(db, email);
  const [userSnapshot, emailSnapshot] = await Promise.all([
    transaction.get(userRef),
    transaction.get(emailRef),
  ]);

  const binding = emailSnapshot.exists ? emailSnapshot.data() : null;
  if (binding && binding.uid !== decoded.uid) {
    throw Object.assign(new Error('This email is already linked to a different Philomarket account. Contact a club admin.'), { status: 403 });
  }
  if (!userSnapshot.exists && emailSnapshot.exists) {
    throw Object.assign(new Error('This Philomarket account already exists but needs recovery. Contact a club admin.'), { status: 409 });
  }

  const userData = userSnapshot.exists
    ? userSnapshot.data()
    : { points: STARTING_POINTS, marketsCreated: 0 };
  if (!Number.isFinite(userData.points) || userData.points < 0) {
    throw Object.assign(new Error('Your account points are unavailable.'), { status: 409 });
  }

  return {
    uid: decoded.uid,
    userRef,
    emailRef,
    userSnapshot,
    userData,
    isNew: !userSnapshot.exists,
    needsEmailBinding: !emailSnapshot.exists,
  };
}

// Call after all transaction reads, so account, market, and position changes
// commit together under Firestore's transaction guarantees.
export function writeAccountContext(transaction, account, FieldValue, updates = {}) {
  if (account.isNew) {
    transaction.create(account.userRef, {
      ...account.userData,
      createdAt: FieldValue.serverTimestamp(),
      ...updates,
    });
  } else if (Object.keys(updates).length) {
    transaction.update(account.userRef, updates);
  }

  if (account.needsEmailBinding) {
    transaction.create(account.emailRef, {
      uid: account.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

export function enforceTradeCooldown(userData) {
  const lastTradeAt = userData.lastTradeAt?.toMillis?.();
  if (!Number.isFinite(lastTradeAt)) return;
  if (Date.now() - lastTradeAt < TRADE_COOLDOWN_MS) {
    throw Object.assign(new Error('Wait a couple of seconds before placing another trade.'), { status: 429 });
  }
}
