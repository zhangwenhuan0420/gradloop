# GradLoop Live MVP

GradLoop is a UK student second-hand marketplace. This version can run as a real MVP:

- Frontend: GitHub Pages
- Database/Auth: Supabase
- Public users can post listings and submit reports
- Admins can log in, review listings, hide/restore listings, mark sold, and read reports
- Buyers can submit protected trade requests for admin follow-up
- Optional WeChat Pay Native QR deposit flow through Supabase Edge Functions

## 1. Create Supabase Project

1. Go to https://supabase.com
2. Create a new project
3. Open `SQL Editor`
4. Paste and run `supabase-schema.sql`

The script creates:

- `listings`
- `listing_reports`
- `trade_requests`
- `admin_users`
- Row Level Security policies

Your admin email is already inserted as:

```text
zhangwenhuan0420@gmail.com
```

## 2. Configure Auth Redirect

In Supabase:

1. Go to `Authentication` -> `URL Configuration`
2. Set Site URL:

```text
https://zhangwenhuan0420.github.io/gradloop/admin.html
```

3. Add Redirect URL:

```text
https://zhangwenhuan0420.github.io/gradloop/admin.html
```

## 3. Configure the Website

Open Supabase `Project Settings` -> `API`, copy:

- Project URL
- anon public key

Then update `config.js`:

```js
window.GRADLOOP_CONFIG = {
  supabaseUrl: "YOUR_SUPABASE_PROJECT_URL",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  adminEmails: ["zhangwenhuan0420@gmail.com"],
  payments: {
    wechatPayEnabled: false,
    wechatNativeFunctionName: "create-wechat-native-order",
    listingCurrency: "GBP",
    settlementCurrency: "CNY",
  },
};
```

The anon public key is safe to use in frontend code because database permissions are controlled by Row Level Security.

Do not paste the Supabase service role key into this project.

## 4. Enable WeChat Pay Deposits

This project uses WeChat Pay Native payments. The GitHub Pages frontend never stores merchant secrets. Supabase Edge Functions create signed WeChat orders and receive payment notifications.

1. Run this SQL in Supabase SQL Editor:

```text
add-wechat-payments.sql
```

2. In WeChat Pay Merchant Platform, make sure Native payment is available. Prepare:

- Merchant ID: `WECHAT_PAY_MCH_ID`
- App ID bound to the merchant: `WECHAT_PAY_APP_ID`
- Merchant API certificate serial number: `WECHAT_PAY_CERT_SERIAL_NO`
- Merchant API private key file: `apiclient_key.pem`
- API v3 key: `WECHAT_PAY_API_V3_KEY`
- WeChat Pay platform public key/certificate public key: `WECHAT_PAY_PLATFORM_PUBLIC_KEY`

Never put `apiclient_key.pem`, API v3 key, service role key, or platform private material into `config.js`, GitHub, or chat.

3. Add Supabase Edge Function secrets:

```text
SUPABASE_URL=https://rtlebdivzzmqnushmaeo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key
WECHAT_PAY_MCH_ID=your merchant id
WECHAT_PAY_APP_ID=your bound app id
WECHAT_PAY_CERT_SERIAL_NO=your merchant API certificate serial number
WECHAT_PAY_PRIVATE_KEY=the full apiclient_key.pem content
WECHAT_PAY_API_V3_KEY=your 32-character API v3 key
WECHAT_PAY_PLATFORM_PUBLIC_KEY=the full WeChat Pay platform public key PEM
WECHAT_PAY_NOTIFY_URL=https://rtlebdivzzmqnushmaeo.functions.supabase.co/wechat-pay-notify
GBP_TO_CNY_RATE=9.20
```

4. Deploy Edge Functions:

```text
supabase functions deploy create-wechat-native-order
supabase functions deploy wechat-pay-notify
```

The repository includes `supabase/config.toml`. Both functions set `verify_jwt = false` because buyers may not be logged in when creating a QR code, and WeChat Pay notification webhooks cannot send a Supabase user JWT. Seller QR generation is still protected inside the function by checking the admin email session.

5. After both functions deploy successfully, turn the frontend payment switch on in `config.js`:

```js
payments: {
  wechatPayEnabled: true,
  wechatNativeFunctionName: "create-wechat-native-order",
  listingCurrency: "GBP",
  settlementCurrency: "CNY",
},
```

Buyer deposits can be generated after a protected trade request is submitted. Seller deposit QR codes are generated from the admin console.

## 5. Deploy

Commit and push to the `gh-pages` branch. GitHub Pages will publish:

```text
https://zhangwenhuan0420.github.io/gradloop/
```

Admin page:

```text
https://zhangwenhuan0420.github.io/gradloop/admin.html
```

## Operating Notes

This MVP is ready for basic public use, but payments/escrow are not enabled yet. For graduation-season launch, start with:

- free listings
- public meet-up safety rules
- manual moderation
- reports handled through the admin page

Add payment, deposit custody, and dispute funds only after legal/payment-provider review.

## Existing Project Migrations

If your project was created before protected trade requests were added, run:

```text
add-trade-requests.sql
```

If your project was created before WeChat Pay deposit orders were added, run:

```text
add-wechat-payments.sql
```

If short listing descriptions fail, run:

```text
fix-description-constraint.sql
```
