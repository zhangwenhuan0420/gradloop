# GradLoop Live MVP

GradLoop is a UK student second-hand marketplace. This version can run as a real MVP:

- Frontend: GitHub Pages
- Database/Auth: Supabase
- Public users can post listings and submit reports
- Admins can log in, review listings, hide/restore listings, mark sold, and read reports
- Buyers can submit protected trade requests for admin follow-up

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
};
```

The anon public key is safe to use in frontend code because database permissions are controlled by Row Level Security.

Do not paste the Supabase service role key into this project.

## 4. Deploy

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

If short listing descriptions fail, run:

```text
fix-description-constraint.sql
```
