# Mechanic Shop Register

A point-of-sale web app for a FiveM mechanic shop. Employees clock in with a PIN, ring up items, apply deals and discounts, and every checkout posts a transaction embed to your Discord webhook. Management can edit items, deals, employees, theme colors, the logo, and shop info — and everyone who visits the site sees the same shared data, powered by Supabase.

Default management login: **Boss** / PIN **1234** (change this immediately after first login).

---

## Step 1 — Create the Supabase project (~5 min)

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty).
2. Click **New project**. Give it any name (e.g. `mechanic-register`), set a database password (you won't need it again for this app), and pick a region close to your players.
3. Wait a minute for the project to finish provisioning.

## Step 2 — Create the tables

1. In your Supabase dashboard, open **SQL Editor** (left sidebar).
2. Click **New query**, paste the entire contents of `supabase-setup.sql` from this project, and click **Run**.
3. You should see "Success". This creates the four tables (`shop_config`, `items`, `deals`, `employees`) plus the starter data, including the default Boss account.

## Step 3 — Get your API keys

1. In the Supabase dashboard go to **Project Settings → API**.
2. Copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## Step 4 — Run it locally (optional but recommended)

You'll need [Node.js](https://nodejs.org) 18+ installed.

```bash
# in the project folder
cp .env.example .env
# open .env and paste in your Project URL and anon key

npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`), log in as Boss / 1234, and make sure everything loads. If you see "Couldn't reach the database", double-check the two values in `.env` and that Step 2 ran successfully.

## Step 5 — Deploy to Vercel (free)

1. Push this folder to a GitHub repository (private is fine):
   ```bash
   git init
   git add .
   git commit -m "Mechanic register"
   # create a repo on github.com, then:
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
3. Import your repo. Vercel auto-detects Vite — leave the build settings alone.
4. Under **Environment Variables**, add both values:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. Click **Deploy**. In about a minute you'll get a live URL like `mechanic-register.vercel.app` that anyone can open.

To use a custom domain later, add it in the Vercel project's **Domains** tab.

## Step 6 — First-time setup in the app

1. Open your live URL, log in as **Boss** / **1234**.
2. Go to **Management → Employees** and change the Boss PIN (or make your own account and delete Boss).
3. Go to **Management → Settings** and:
   - Set your shop name, tagline, and upload your logo PNG
   - Pick your theme colors (saved for everyone, they persist forever)
   - Paste your Discord webhook URL (Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL)
   - Edit the Info panel text
4. Add your real items and deals under **Management → Items / Deals**.

Share the URL with your employees — they'll see the employee list on the login screen and clock in with the PIN you give them.

---

## Things worth knowing

- **Data is shared.** Items, prices, deals, employees, colors, and the logo live in Supabase, so every visitor sees the same shop. Changes save automatically as you type (settings save when you hit the Save button).
- **Data updates on page load.** If a manager changes prices while an employee has the page open, the employee sees the new prices after refreshing.
- **Security level: RP-grade, not bank-grade.** PINs are stored in plain text and the database is open to anyone holding your site's anon key (which is visible in the page source). That's a deliberate simplicity trade-off, and it's how most FiveM shop tools work. Practical implications:
  - Don't reuse a PIN you use anywhere real.
  - Someone determined could read your webhook URL and spam it; if that happens, delete the webhook in Discord and make a new one.
  - If you ever want real security (hashed PINs, locked-down policies, server-side webhook), that's a Supabase Auth + Edge Functions upgrade — the schema here won't need to change much.
- **Images** are resized to 320px and stored as base64 in the database, so no separate file storage is needed. Keep uploads reasonable (icons/product shots, not wallpapers).
- **Free-tier limits** on Supabase (500MB database) and Vercel are far more than this app will ever use.

## Project structure

```
mechanic-register/
├── index.html            # page shell
├── package.json          # dependencies & scripts
├── vite.config.js        # build config
├── supabase-setup.sql    # run once in Supabase SQL Editor
├── .env.example          # copy to .env, add your keys
└── src/
    ├── main.jsx          # React entry point
    ├── supabase.js       # database client
    └── App.jsx           # the entire app (all panels, cart, styling)
```
