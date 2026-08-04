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

Verify a sending domain with Resend and set:

```text
RESEND_API_KEY=...
EMAIL_FROM=SEMCME Virtual Membership <members@your-domain.org>
SUPPORT_EMAIL=cszydlowski@semcme.org
BASE_URL=https://virtual.semcme.org
```

If email is not configured in local development, the sign-in link is shown on screen for testing.

### SEMCME.org carousel

The member hero carousel is scraped from `https://semcme.org/` by default. Slides are included when the title or slide text contains `virtual`, which also matches `virtually`. Each matching slide brings over its title, body text, button link/label, and background image.

The server refreshes the SEMCME.org scrape once per day by default, and open member dashboards check the hero list daily. If a virtual slide is added or removed on SEMCME.org, the Virtual Membership carousel follows automatically on the next daily refresh. Staff can also use `Refresh programs` in the admin dashboard for an immediate manual sync. `SEMCME_HERO_REFRESH_MS` is clamped to a minimum of one day to avoid checking SEMCME.org too frequently.

## Staff workflow

Visit `/admin.html`, sign in with `ADMIN_PASSWORD` or the shared `GLOBAL_ADMIN_PASSWORD`, and use:

- `Refresh programs` to re-scrape SEMCME.org virtual hero slides.
- `Sync members` to import contacts from the Constant Contact Virtual Members list.
- `Library content` to add, update, hide, move, or remove program areas and resources in the Upcoming programs, Current & previous academic year, and Archive sections.

Embedded YouTube playlists use YouTube's live playlist player. If videos are added to the playlist in YouTube, the embedded playlist reflects those additions automatically. If a video or playlist is private, age-restricted, or has external playback disabled, turn off `Embed YouTube player when possible` so members see a clean link instead of a broken player.

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
RESEND_API_KEY=...
EMAIL_FROM=SEMCME Virtual Membership <members@your-domain.org>
SUPPORT_EMAIL=cszydlowski@semcme.org
SEMCME_HOME_URL=https://semcme.org/
SEMCME_HERO_REFRESH_MS=86400000
```

## Production notes

- Use HTTPS and set `NODE_ENV=production` so cookies receive the `Secure` flag.
- Back up `data/semcme.db` regularly, or migrate the small tables to the production database platform.
- Rotate `COOKIE_SECRET` if you suspect sign-in cookie exposure.
