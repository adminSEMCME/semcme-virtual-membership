# SEMCME Virtual Membership

A self-contained member portal for SEMCME virtual membership access. It includes:

- Email magic-link sign-in
- Local SQLite member and support-request storage
- Constant Contact Virtual Members contact-list lookup and admin sync
- SEMCME.org virtual-program hero carousel sync
- Database-managed program areas with upcoming, current, and archived resources
- Staff dashboard for content updates, member sync, virtual program refresh, and support inquiries

## Run locally

Requires Node.js 22.5 or newer. No package installation is needed.

```bash
cp .env.example .env
# Optional: copy local overrides into .env.local. The server loads both files.
npm start
```

Open `http://localhost:3000`. The staff dashboard is at `http://localhost:3000/admin.html`.

The default local admin password is `admin-demo-2026` unless `ADMIN_PASSWORD` is set.

## External services to configure

### Constant Contact

Set the Virtual Members contact-list credentials:

```text
CONSTANT_CONTACT_ACCESS_TOKEN=...
CONSTANT_CONTACT_CLIENT_ID=...
CONSTANT_CONTACT_CLIENT_SECRET=...
CONSTANT_CONTACT_REDIRECT_URI=https://virtual.semcme.org/api/admin/constant-contact/callback
CONSTANT_CONTACT_REFRESH_TOKEN=...
CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_ID=bd3e4866-8aaf-11f1-9615-02420a320002
CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_NAME=SEMCME - Virtual Members
VIRTUAL_MEMBERSHIP_REGISTRATION_URL=https://lp.constantcontactpages.com/sl/8vmbMa9
```

When a user requests a sign-in link, the app checks whether the email is an active contact on the `SEMCME - Virtual Members` Constant Contact list. If the contact is found, the app creates or updates a local member row and sends the magic link. If the contact is not found, the login form points the user to the Virtual Membership registration landing page.

For Vercel env-only deployments, use a long-lived refresh token. Rotating refresh tokens require durable storage for the newly rotated token value.

### Email

Verify a sending domain with Resend and set SMTP delivery to match the other SEMCME projects:

```text
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=...
SMTP_FROM=SEMCME Virtual Membership <members@mail.semcme.org>
SUPPORT_EMAIL=cszydlowski@semcme.org
BASE_URL=https://virtual.semcme.org
```

`RESEND_API_KEY` and `EMAIL_FROM` can remain configured as a fallback, but SMTP is preferred for production.

If email is not configured in local development, the sign-in link is shown on screen for testing.

### SEMCME.org carousel

The member hero carousel is scraped from `https://semcme.org/` by default. Slides are included when the title or slide text contains `virtual`, which also matches `virtually`. Each matching slide brings over its title, body text, button link/label, and background image.

Production uses a Vercel cron job at `0 10 * * *` (10:00 UTC daily, 6 a.m. Eastern daylight time / 5 a.m. standard time). Before deploying, add a random `CRON_SECRET` of at least 32 characters to the Vercel project's **Production** environment variables. Vercel sends it as a bearer token to `/api/cron/sync-programs`. Confirm the job is enabled in Vercel Settings > Cron Jobs after deployment. Hobby plans may run it anywhere within the scheduled hour.

The successful refresh timestamp and events are stored in the database, so server restarts do not reset the daily cache. Page requests also refresh stale data as a fallback. Open member pages check the saved library every minute; this does not scrape SEMCME.org every minute. Staff can use **Refresh programs** for an immediate source refresh. Failed fetches or missing carousel markup preserve previous events and display the error in admin. A valid carousel with no virtual events clears imported banners and hides unmodified imported library entries.

Imported events receive stable identities based on registration URLs, ignoring tracking parameters. Known program titles and category keywords route events automatically; unrecognized events go to Additional Program Offerings with a review notice. Events default to Upcoming; EHR, modules, and on-demand resources go to Current. Explicit full dates in banner text use the last date for multi-session events, moving past events to Current or Archive using July academic-year boundaries. Dates without a year are not guessed. A registration link remains a registration link; the system does not invent a recording when an event ends.

**Admin control:** Every library item has a Program destination and Section selector. Move an existing item by changing these and saving; its ID, details, and playlist videos remain intact. Saving an imported item makes it admin-managed, so future source refreshes preserve its content and placement, even after its banner is removed. Deleting an imported item suppresses its recreation. The banner list shows its program/section, hidden or removed status, review flag, and a Move / edit button.

A one-time database migration reorganizes existing recordings into Pediatrics, Hot Topics, Lecture Series and Modules, and Additional Program Offerings; renames JEDI to Justice in Healthcare; removes the obsolete virtual QI registration; and adds EHR, Advocacy 101, and two Home Buying recordings already referenced in the bundled playlists. Home Buying dates were unavailable, so those are labeled Recording 1/2 in Archive. Existing playlist collections remain intact. The migration also runs for fresh installations and does not rerun after staff edits.

Run `npm run check` and `npm test` before pushing. The integration test uses a temporary SQLite database and mocked source pages; it does not access production data or send mail. Production requires durable database storage (`DATABASE_URL`) for sync timestamps and admin decisions to survive serverless restarts.

## Staff workflow

Visit `/admin.html`, sign in with `ADMIN_PASSWORD` or the shared `GLOBAL_ADMIN_PASSWORD`, and use:

- `Refresh programs` to sync both virtual hero slides and their library placements.
- `Sync members` to import contacts from the Constant Contact Virtual Members list.
- `Library content` to add, update, hide, move, or remove program areas and resources in the Upcoming programs, Current & previous academic year, and Archive sections.

Embedded YouTube playlists with imported video details use an on-site player and video queue. Selecting a title in the queue loads that video without sending the member away from the Virtual Membership site. If imported video details are unavailable, the card falls back to YouTube's embedded playlist player. If a video or playlist is private, age-restricted, or has external playback disabled, turn off `Embed YouTube player when possible` so members see a clean link instead of a broken player.

The dashboard also lists local members and support questions.

## Local and Vercel environment variables

Set these locally in `.env.local` and in Vercel Project Settings > Environment Variables when the app is ready to connect external services:

```text
BASE_URL=https://virtual.semcme.org
PRODUCTION_BASE_URL=https://virtual.semcme.org
GLOBAL_ADMIN_USERNAME=optional-shared-admin-username
GLOBAL_ADMIN_PASSWORD=use-the-shared-admin-password
COOKIE_SECRET=use-a-long-random-secret
ADMIN_PASSWORD=use-a-strong-admin-password
DATABASE_URL=...
VIRTUAL_MEMBERSHIP_REGISTRATION_URL=https://lp.constantcontactpages.com/sl/8vmbMa9
CONSTANT_CONTACT_ACCESS_TOKEN=...
CONSTANT_CONTACT_CLIENT_ID=...
CONSTANT_CONTACT_CLIENT_SECRET=...
CONSTANT_CONTACT_REFRESH_TOKEN=...
CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_ID=bd3e4866-8aaf-11f1-9615-02420a320002
CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_NAME=SEMCME - Virtual Members
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=...
SMTP_FROM=SEMCME Virtual Membership <members@mail.semcme.org>
RESEND_API_KEY=...
EMAIL_FROM=SEMCME Virtual Membership <members@mail.semcme.org>
SUPPORT_EMAIL=cszydlowski@semcme.org
SEMCME_HOME_URL=https://semcme.org/
SEMCME_HERO_REFRESH_MS=86400000
```

## Production notes

- Use HTTPS and set `NODE_ENV=production` so cookies receive the `Secure` flag.
- Back up `data/semcme.db` regularly, or migrate the small tables to the production database platform.
- Rotate `COOKIE_SECRET` if you suspect sign-in cookie exposure.
