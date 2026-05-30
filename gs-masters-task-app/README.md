# GS Masters Field App

Task management app for G.S. Masters, Inc. construction crews.

## Demo Logins
| Name | Email | PIN | Role |
|------|-------|-----|------|
| Gregory Masters | gsmastersinc@gmail.com | 1234 | Admin |
| Alberto Garcia | alberto@gsm.com | 2222 | Crew |
| Alex Reyes | alex@gsm.com | 3333 | Crew |
| Scott Masters | scott@gsm.com | 4444 | Crew |

## Deploy to Netlify (Drag & Drop — No GitHub needed)

1. Open a terminal in this folder
2. Run: `npm install`
3. Run: `npm run build`
4. Go to [netlify.com](https://netlify.com) and log in
5. Click **"Add new site"** → **"Deploy manually"**
6. Drag the `build` folder into the Netlify drop zone
7. Done — your site is live!

## After Deploying — Settings Setup

In the Admin app, go to **Settings** and enter:

- **Google Sheets ID** — from the URL of your GS Masters Inc Google Sheet
- **Google Drive Folder ID** — from the URL of the Drive folder you create
- **Twilio Account SID + Auth Token + Phone** — new GS Masters Twilio number
- **Google Translate API Key** — from Google Cloud Console (free tier)
- **Reminder Time** — defaults to 5:00 PM

## Tech Stack
- React 18
- Google Sheets API (data storage)
- Google Drive API (photo/receipt storage)
- Twilio (SMS reminders)
- Google Translate API (EN ↔ ES)
- Netlify (hosting)

## 5 PM Daily-Log Reminders (Twilio + Netlify)

The app texts crew who haven't logged their day, with a one-tap link
straight to their log screen. This runs on Netlify's servers so it fires
even when nobody has the app open.

### Setup
1. In Netlify → Site settings → Environment variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (the service_role key — server only)
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM` (your GS Masters Twilio number)
   - `APP_URL` (e.g. https://gsmfield.netlify.app)
   - `REMINDER_TZ_OFFSET` (Alabama: -5 in summer/CDT, -6 in winter/CST)

2. Deploy. Netlify auto-detects the scheduled function `daily-reminder`.

3. The schedule is set in `netlify/functions/daily-reminder.mjs`:
   `schedule: "0 22 * * *"` = 22:00 UTC ≈ 5 PM Central.
   Change the cron string to adjust the time.

### Test it
In Admin → Settings → Reminders, enter your own phone number and tap
"Send Test." (Works once deployed with the Twilio env vars set.)

### Functions included
- `daily-reminder.mjs` — scheduled 5 PM nudge to crew who haven't logged
- `send-sms.mjs` — on-demand single SMS (powers the test button)
