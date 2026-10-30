# Philomarket

Philomarket is a points-only prediction market for club questions. Verified email accounts start with 500 points. People can create markets, buy outcome positions, and sell those positions back at the current market quote. Points have no cash value and cannot be redeemed.

Outcome prices use a simulated $1 contract scale: a `$0.12` price represents a 12% implied chance. A high-liquidity LMSR curve determines the shares received for a point spend. Selling removes those same shares from that curve and returns its cost difference, rounded down to hundredths of a point. An immediate buy-and-sell round trip breaks even at best; intervening trades change the resale quote. The chart stores up to 200 recent price snapshots per market.

## Local preview

Install the app dependencies and start Vite:

```sh
npm install
npm run dev
```

With no Firebase client keys, the development page runs a clearly labeled local preview with 500 sample points. You can browse and create sample markets in that browser. Backing and selling always require a verified account, so trading is unavailable until Firebase is configured.

## Firebase setup

The app uses Firebase Authentication for email/password sign-up and verification, Cloud Firestore for shared market, account, position, and price-history records, and Vercel Functions for server-side writes. Client-side Firestore access is denied by `firestore.rules`; the API checks verified ID tokens and atomically changes point balances, positions, prices, and price history. A hashed email binding prevents deleting and recreating the same verified address to reclaim the 500-point allowance. Hosted Vercel Preview and Production environments fail closed until `PHILOMARKET_ALLOWED_EMAILS` is configured. Use comma-separated addresses to limit access to a list, or `*` to allow any email after Firebase verification. Email verification alone cannot prove one human per account, so the wildcard setting permits anyone to create an account.

To limit spam and wash-trading, each account can create at most 10 markets and place one trade every two seconds. “Points in play” tracks net open market spend, not gross buy/sell turnover, and the backer count only increments once per account per market. Public market and history reads use short CDN caching; authenticated market-list responses remain private.

1. Create a Firebase project on the Spark plan and register a web app.
2. In Authentication, enable **Email/Password**. Keep email verification enabled.
3. Create the default Firestore database and publish `firestore.rules` from the Firebase console.
4. In Project settings → General → Your apps, copy the web app values into `.env.local` using these names:

   ```env
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_APP_ID=...
   ```

5. For local shared-account testing, you can add `PHILOMARKET_ALLOWED_EMAILS` with comma-separated, verified email addresses. Set it to `*` to allow any Firebase-verified email. Vercel Preview and Production require this setting before account, trade, or market-creation APIs will work.

6. Generate a service-account key in Project settings → Service accounts. Store its full JSON as `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel **server-side only**. Never commit or paste this private key into the browser config, a public repository, or chat.
7. Add the production `*.vercel.app` domain under Firebase Authentication → Settings → Authorized domains.

Firebase Spark currently includes free Authentication for email/password, and Firestore's free quota includes 50,000 reads and 20,000 writes per day. If Firestore exceeds its free quota, that service stops until the next quota period unless the project is moved to a paid billing plan. See [Firebase Spark pricing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).

## Vercel deployment

Vercel Hobby is free for personal, non-commercial projects, subject to its usage limits. Vercel's current terms allow Hobby project content to be used for AI training and shared with third parties for product improvement; the account owner can opt out in Vercel's team settings. Since this app includes club initiates' names, review that setting before publishing. See Vercel's [terms](https://vercel.com/legal/terms), [Hobby plan](https://vercel.com/docs/plans/hobby), and [limits](https://vercel.com/docs/limits).

Once Firebase is configured and the hosting terms are acceptable:

1. Sign in to Vercel and run `vercel` from this directory, or connect the project in the Vercel dashboard.
2. Set the four `VITE_FIREBASE_*` values, `FIREBASE_SERVICE_ACCOUNT_JSON`, and `PHILOMARKET_ALLOWED_EMAILS` in the Vercel project's environment variables for Production and Preview. Use a comma-separated list of allowed email addresses, or `*` to allow any email after Firebase verification.
3. Deploy with `vercel --prod`.

Vercel builds the static app into `dist`; the files under `api/` run as serverless functions. The local preview does not connect to Firebase or Vercel.
