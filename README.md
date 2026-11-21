# CampusQuest

A gamified college learning platform built from the **CampusQuest SRS v1.0** and the clickable design prototype.
Students earn XP, levels, badges and streaks, take quizzes, complete quests and climb course leaderboards.
Instructors build courses and see analytics. Administrators manage users, courses and platform settings.

**Stack:** Node.js + Express 5 · MongoDB (Mongoose) · vanilla ES-module front end (no build step).

## Quick start

Requires Node 20+ and a MongoDB server on `localhost:27017`.

```powershell
npm install
copy .env.example .env      # then set JWT_SECRET (a random string is already in .env if you used the setup script)
npm run seed                # WIPES the database in MONGO_URI and loads demo data
npm run dev                 # http://localhost:3000 - restarts by itself when server code or .env changes
# npm start                 # same server without auto-restart (use this in production)
```

Demo accounts created by `npm run seed` (local use only; set `SHOW_DEMO_ACCOUNTS=true` to list them on the login page):

| Role | Email | Password |
| --- | --- | --- |
| Student | areeb@campusquest.test | Learn1234 |
| Instructor | farooq@campusquest.test | Teach1234 |
| Admin | admin@campusquest.test | Admin1234 |

CS-305 (Algorithms) is restricted: enrollment code `ALGO305`.

Try the gameplay loop as Areeb: *Learn → Continue lesson → Mark as complete* (lesson, module, daily quest,
course quest and 7-day-streak rewards fire together and trigger a level-up), then take the *Stacks & Queues* quiz.
Retaking the quiz or re-completing the lesson awards nothing twice.

## Tests

```powershell
npm test
```

25 API tests run against an isolated `campusquest_test` database (`TEST_MONGO_URI` overrides it). They cover the
SRS test cases for duplicate-XP prevention (TC-008, TC-012), quiz attempt limits (TC-010), role boundaries
(TC-004, TC-018), validation (TC-019), streak rules, level formula, leaderboard privacy and analytics.

## How the SRS maps to the code

| SRS area | Where |
| --- | --- |
| Auth, RBAC, password reset (FR-001..010), email verification, Google sign-in | `server/routes/auth.js`, `server/middleware/auth.js`, `server/services/mailer.js`, `server/services/authTokens.js` |
| Profiles (FR-011..018) | `server/routes/users.js` |
| Courses, enrollment (FR-019..028) | `server/routes/courses.js`, `server/lib/access.js` |
| Modules & lessons, progress (FR-029..047) | `server/routes/content.js`, `server/services/progress.js` |
| Quizzes (FR-048..066) | `server/routes/quizzes.js` |
| Quests (FR-067..080) | `server/routes/quests.js`, `server/services/quests.js` |
| XP & levels (FR-081..090) | `server/services/gamification.js`, `server/lib/levels.js` |
| Achievements (FR-091..099) | `server/services/achievements.js` (conditions are data, 8 defaults in `services/defaults.js`) |
| Streaks (FR-100..107) | `server/services/streaks.js`, `server/lib/dates.js` |
| Leaderboards (FR-108..115) | `server/routes/gamification.js` |
| Notifications (FR-116..123) | `server/routes/notifications.js`, `server/services/scheduler.js` |
| Instructor analytics (FR-124..132) | `server/routes/instructor.js` |
| Admin (FR-133..140) | `server/routes/admin.js`, `server/services/audit.js` |

The REST endpoints follow SRS section 10. Extra endpoints added where the UI needed them: question CRUD
(`/api/quizzes/:id/questions`, `/api/questions/:id`), `/api/quizzes/:id/abandon`, module/lesson reorder,
course announcements, `/api/users/history`, `/api/users/password`, and the admin endpoints.

### Reward integrity (the core design rule)

* XP is only created by `awardXp()` on the server. The client never sends an XP value.
* Every reward has a deterministic `eventKey` (for example `lesson:<id>:<student>` or
  `quest:<id>:<student>:<period>`) with a **unique index** on `xpTransactions.eventKey`. A duplicate or racing
  request hits the index and pays nothing (FR-078, FR-089, NFR-026). A test fires five concurrent requests.
* Quiz scoring is server-side; questions are sent to the client without correct answers.
* If a reward step fails, the lesson completion is rolled back so nothing is falsely confirmed.

### Decisions made where the SRS left choices open

| Question the SRS raised | Decision |
| --- | --- |
| Reward stacking | Separate events, each with its own key: lesson, module, quest, streak milestone, quiz pass, quiz bonus. |
| Quiz rewards | Pass XP and 90% bonus are granted **once per quiz** (first qualifying attempt). Retakes are recorded without XP. |
| Quiz timing | Attempt limit counts submitted attempts. Leaving a quiz discards it; a timed-out attempt is auto-graded. Answers arriving more than 60 s after the timer are ignored. |
| Streak timezone & reset | `APP_TIMEZONE` (default `Asia/Karachi`, editable in Admin → Settings). One streak day per calendar day; a missed day resets to 1; longest is preserved. |
| Enrollment policy | Open by default; instructors can close enrollment or require a code. |
| Level formula | `100 × L × (L−1) / 2` (SRS 6.4), base configurable. |
| Daily / weekly quests | Recur each day / ISO week until their deadline; one reward per period. |
| Leaderboard | Ranked by total XP among students enrolled in the course. Students can opt out and appear as "Anonymous learner". |
| Instructor sign-up | Allowed (UC-01) but admins can switch it off. Admin accounts are never self-registered (`ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstraps the first one). |

## Authentication

| Flow | How it works |
| --- | --- |
| Sign up with email | `POST /api/auth/register` stores a *pending* sign-up (password already hashed) and emails a **6-digit code and a link**. **No account exists until one of them is used**: the code is typed on the "Check your email" screen (`#/check-email`, also reachable from "Have a verification code?" on the login page) via `POST /api/auth/verify-code`; the link (`/verify?token=…`) uses `POST /api/auth/verify-email`. Either creates the account and signs the user in. Single-use, 24 h expiry; a code locks after 5 wrong tries. While `APP_URL` is `localhost`, the link only works on the computer running the server, so use the code when reading email on a phone. |
| Log in | Only verified accounts can log in. Logging in before verifying says so (only if the password is right) and offers to resend the link. |
| Continue with Google | OAuth 2.0 authorization-code flow with PKCE, `state` and `nonce` (`GET /api/auth/google` → Google → `/api/auth/google/callback`). Google must report the email as verified. A first Google sign-in creates a student (or instructor, if chosen and allowed); if the email already has an account, Google is linked to it. Google-only users can add a password later in their profile. |
| Forgot password | Emails a 1-hour single-use link. Resetting signs out every other session. |
| Admin creates a user | The admin never picks the password: the user gets a 72-hour invitation to set their own, which also verifies their email. "Resend invite" is in Admin → Users. |
| Change password | Requires the current password (unless the account is Google-only) and signs out other devices. |

### Setting up email (required in production)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `.env`. Any SMTP provider works:

* **Gmail** (small scale): `smtp.gmail.com`, port `465`, `SMTP_SECURE=true`, your Gmail address, and an
  [App password](https://myaccount.google.com/apppasswords) (requires 2-step verification). Gmail limits sending to about 500 emails/day.
* **For a real deployment**, use a transactional provider such as Brevo, Mailgun, SendGrid, Amazon SES or Resend, with your college domain.

Without `SMTP_HOST` (development only) emails are printed in the server console and the screen shows a
"development mode" link, so you can test without an email account. The server refuses to start in production without SMTP.

### Setting up "Continue with Google"

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. *APIs & Services → OAuth consent screen*: choose **External**, fill in the app name and support email, add the scopes `openid`, `email`, `profile`.
3. *Credentials → Create credentials → OAuth client ID* → **Web application**.
   * Authorised JavaScript origin: your `APP_URL` (e.g. `http://localhost:3000`)
   * Authorised redirect URI: `APP_URL` + `/api/auth/google/callback` (e.g. `http://localhost:3000/api/auth/google/callback`)
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart. The Google button appears automatically.
5. While the consent screen is in *Testing* mode only the test users you list can sign in; publish it for everyone.

`ALLOWED_EMAIL_DOMAINS=uni.edu.pk` restricts sign-up (email and Google) to college addresses.

## Deploy for free on Vercel (recommended)

Vercel's free Hobby plan runs the API as a serverless function (`api/index.js`), serves `public/` from its CDN,
allows Gmail SMTP (ports 465/587), wakes up in about a second and runs the deadline reminders once a day (`vercel.json` cron).
The database is MongoDB Atlas (free cluster, see step 1 of the Render guide below for creating the user and connection string).

1. Put the Atlas connection string in `.env.production` (this file stays on your computer):
   `MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/campusquest?retryWrites=true&w=majority`
2. Log in to Vercel once: `npx vercel@65.16.0 login` and approve it in the browser.
3. Deploy: `npm run deploy`. The script links the Vercel project, uploads the settings (email and Google from `.env`,
   database from `.env.production`, newly generated `JWT_SECRET`/`CRON_SECRET`) without printing them, and deploys.
4. Sign up on the live site, then make yourself admin: `npm run make-admin -- you@example.com --prod`.
5. Google sign-in: add `https://<your-app>.vercel.app/api/auth/google/callback` as an Authorised redirect URI.

Run `npm run deploy` again whenever you want to publish new changes.

## Deploy for free (Render + MongoDB Atlas + Brevo)

| Piece | Free service | Free allowance |
| --- | --- | --- |
| Web server | [Render](https://render.com) web service | 750 hours/month; sleeps after 15 min without visitors (first visit then takes ~1 min) |
| Database | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) Free cluster | 512 MB |
| Email | [Brevo](https://www.brevo.com) transactional API | 300 emails/day |

Render's free plan blocks SMTP ports, so Gmail SMTP does not work there. The app sends through Brevo's HTTPS API instead
when `BREVO_API_KEY` is set.

### 1. Database - MongoDB Atlas

1. Sign up, then **Create** a cluster and choose **Free**. Pick AWS and a region near Render's Singapore region (e.g. Singapore or Mumbai).
2. **Database Access → Add new database user**: username + a strong password (letters and numbers only is simplest).
3. **Network Access → Add IP address → Allow access from anywhere** (`0.0.0.0/0`). Render's free plan has no fixed IP address.
4. **Connect → Drivers**, copy the connection string, put your password in and add the database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/campusquest?retryWrites=true&w=majority`
   (If the password has symbols like `@ : / ?`, URL-encode them.)

### 2. Email - Brevo

1. Sign up for the free plan.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: the address emails should come from (your Gmail works), then confirm it from your inbox.
   With a Gmail/Yahoo address Brevo shows it "via brevosend.com"; for a professional look, authenticate your own domain later.
3. **SMTP & API → API keys → Generate a new API key** and copy it.
4. **Settings → Security → Authorised IPs**: turn IP blocking **off** (Render's IP address changes, so Brevo would otherwise reject it).
5. Optional local check: put `BREVO_API_KEY=...` in your `.env` and run `npm run mail:test -- you@example.com`.

### 3. Web server - Render

1. Sign up with your GitHub account.
2. **New → Blueprint**, pick this repository. Render reads [`render.yaml`](render.yaml) and asks for:
   * `MONGO_URI` - the Atlas string from step 1
   * `BREVO_API_KEY` - from step 2
   * `MAIL_FROM` - `CampusQuest <the-sender-you-verified@gmail.com>`
   * `ADMIN_EMAIL` / `ADMIN_PASSWORD` - your first admin login (created on first start)
   * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - optional; leave empty to hide the Google button
3. **Apply**. The first build takes a few minutes. Your site is at `https://campusquest.onrender.com`
   (Render adds a suffix if the name is taken). `JWT_SECRET` is generated for you and the public URL is detected automatically.
4. Log in with the admin account. Every push to `main` redeploys automatically.

### 4. Google sign-in on the live site (optional)

In Google Cloud Console → your OAuth client, add:
* Authorised JavaScript origin: `https://<your-app>.onrender.com`
* Authorised redirect URI: `https://<your-app>.onrender.com/api/auth/google/callback`

Then publish the OAuth consent screen so everyone (not just test users) can sign in.

### Free-tier trade-offs

* After 15 minutes without visitors the server sleeps; the next visitor waits about a minute. Deadline-reminder
  notifications only go out while the server is awake.
* Do **not** run `npm run seed` against the live database: the demo accounts' passwords are public. The seed script refuses unless forced.
* Atlas Free has no automatic backups. Export data from Atlas occasionally if it matters.

## Security notes

* Passwords hashed with bcrypt (cost 12); JWT (HS256) in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
  Each token carries a version number, so changing or resetting a password revokes every older session.
* Email links store only a SHA-256 hash of the token, are single-use (atomic) and expire automatically (MongoDB TTL index).
* Every route enforces authentication, role, ownership (instructors only touch their own courses) and server-side
  validation (zod). User and role state is re-read on each request, so suspensions and role changes apply immediately.
* Login, sign-up, reset and email endpoints are rate-limited and do not reveal whether an email exists
  (the exception is sign-up itself, which has to say "already registered").
* Helmet CSP, Origin check on writes, regex-escaped search, URL scheme allow-list for lesson links, output escaped on the client.
* Sensitive operations (role/status changes, course status, settings, announcements, deletions) are written to `auditLogs`.

## Known MVP limitations

* Accounts that existed before email verification was added are treated as already verified.
* Free hosting (see "Deploy for free") gives HTTPS automatically, but no database backups (NFR-028) and the server sleeps when idle.
* Lesson content is text with simple formatting; file uploads are links only (per FR-035).
* Out of scope per SRS section 14: AI features, live video, native apps, payments, offline sync.
