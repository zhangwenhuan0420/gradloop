# GradLoop Free Trial

GradLoop is a free trial marketplace prototype for UK-based Chinese students to post second-hand items they want to buy or sell.

This GitHub Pages version is intentionally free for market research:

- No platform management fee
- No payment account setup
- No real escrow integration
- Listings and favorites are stored locally in the browser for demo use

## Deploy to GitHub Pages

1. Create a new GitHub repository, for example `gradloop`.
2. Upload all files from this folder to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `.nojekyll`
   - `README.md`
3. Go to repository `Settings`.
4. Open `Pages`.
5. Under `Build and deployment`, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
6. Save and wait for GitHub to publish the site.

Your test site will look like:

```text
https://YOUR_GITHUB_USERNAME.github.io/gradloop/
```

## Notes Before Real Launch

This prototype is for user research only. Before real transactions, add a backend, database, image upload, login, moderation, legal pages, privacy policy, and a compliant payment provider.
