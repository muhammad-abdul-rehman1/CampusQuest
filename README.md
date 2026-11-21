# CampusQuest

A gamified college learning platform. Students earn XP, levels, badges and streaks as they complete lessons,
quizzes and quests, and compete on course leaderboards. Instructors build courses and follow their students'
progress. Administrators run the platform.

**Live site: https://campusquest-delta.vercel.app**

Built from the *CampusQuest SRS v1.0* and its clickable design prototype.

---

## Features

**Students**
- Join courses (open, or with an enrollment code) and study modules and lessons
- Earn XP for lessons (10), modules (75), passed quizzes (30) and 90%+ scores (+50), and level up
- Timed quizzes with attempt limits, graded on the server
- Daily, weekly and one-time quests with bonus XP
- Study streaks with a 7-day milestone reward, and 8 achievement badges
- Course leaderboards, with an option to appear as "Anonymous learner"
- Notifications for level-ups, badges, deadlines and announcements

**Instructors**
- Create courses, modules and lessons; draft, publish or archive them
- Build quizzes by hand or **import questions from a CSV file** (template download and a ready-made AI prompt included)
- Create quests, post announcements and send reminders
- Analytics dashboard: enrollment, quiz scores, completion, daily activity and students who need attention

**Administrators**
- Platform dashboard, user management (roles, suspend/reactivate, email invitations), course status
- Platform settings: XP values, level curve, streak reward, timezone, instructor sign-up on/off
- Audit log of sensitive actions

**Accounts**
- Sign-up with **email verification**: a 6-digit code (works when the email is read on a phone) or a link
- **Continue with Google**
- Password reset by email, invitations for admin-created accounts, sessions revoked on password change

## Tech stack

| Part | Technology |
| --- | --- |
| Front end | Vanilla JavaScript ES modules, HTML and CSS; no build step |
| Back end | Node.js, Express 5, zod validation, helmet, express-rate-limit |
| Database | MongoDB with Mongoose (MongoDB Atlas in production) |
| Auth | bcrypt passwords, JWT in an httpOnly cookie, Google OAuth 2.0 with PKCE |
| Email | Nodemailer over Gmail SMTP (Brevo's HTTPS API is also supported) |
| Hosting | Vercel (serverless function + CDN), free Hobby plan |
| Tests | `node --test` with supertest, against a separate test database |

## Using the live site

- **Sign up** at https://campusquest-delta.vercel.app/#/register as a student or an instructor. The account is
  created only after you enter the 6-digit code from the verification email (or open its link).
- **Continue with Google**
  - On the **sign-up page** it creates the account with the role you ticked.
  - On the **login page** it signs in to your existing account. If that Google address has no account yet,
    you are asked "Student or Instructor?" before anything is created.
- **Admins**: the first admin is made from an existing account with
  `npm run make-admin -- you@example.com --prod`. After that, admins manage everyone in **Admin → Users**.
- Instructor self-sign-up can be switched off in **Admin → Settings**; admins can still invite instructors.

## Project structure

```
api/index.js            Vercel entry point: runs the Express app as a serverless function
public/                 Front end (served by Vercel's CDN): index.html, css/, js/ (pages/ per role)
server/
  app.js                Express app: security headers, routes, error handling
  index.js              Local/long-running server (npm start / npm run dev)
  config.js             Settings from environment variables, production checks
  models/               Mongoose models (users, courses, quizzes, XP, quests, ...)
  routes/               REST API (auth, users, courses, content, quizzes, quests, admin, ...)
  services/             Rewards, streaks, achievements, email, scheduler, audit, ...
  scripts/              deploy-vercel, make-admin, test-email
  seed.js               Demo data for local development
tests/                  API and unit tests
vercel.json             Vercel routing, security headers, region, daily cron
render.yaml             Alternative deployment on Render (see below)
```

## Run it locally

Requires **Node.js 20+** and **MongoDB** running on `localhost:27017`.

```powershell
npm install
copy .env.example .env
npm run seed
npm run dev
```

Open http://localhost:3000. `npm run seed` **wipes** the local database and loads demo data. `npm run dev`
restarts the server automatically when server code or `.env` changes; refresh the browser after front-end changes.

Demo accounts created by the seed script (local only; set `SHOW_DEMO_ACCOUNTS=true` to list them on the login page):

| Role | Email | Password |
| --- | --- | --- |
| Student | areeb@campusquest.test | Learn1234 |
| Instructor | farooq@campusquest.test | Teach1234 |
| Admin | admin@campusquest.test | Admin1234 |

Try the gameplay loop as Areeb: *Learn → Continue lesson → Mark as complete*, then take the *Stacks & Queues* quiz.
CS-305 (Algorithms) needs the enrollment code `ALGO305`.

Without email settings, verification emails are printed in the server console and the screen shows a
"development mode" link, so you can sign up without a mail account.

## npm scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server with auto-restart |
| `npm start` | Local server without auto-restart |
| `npm test` | Run all tests (uses the separate `campusquest_test` database) |
| `npm run seed` | Wipe the **local** database and load demo data (refuses remote databases) |
| `npm run mail:test -- you@example.com` | Send a test email with the current email settings |
| `npm run deploy` | Upload the settings to Vercel and deploy to production |
| `npm run make-admin -- you@example.com [--prod]` | Give an existing account the admin role (`--prod` = live database) |

## Configuration

Local settings live in `.env` (copy `.env.example`). Production-only values live in `.env.production`.
**Both files stay on your computer:** they are in `.gitignore` and `.vercelignore`.

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string. Local: `mongodb://127.0.0.1:27017/campusquest`; production: the Atlas string in `.env.production` |
| `JWT_SECRET` | Signs login sessions. Production value is generated by `npm run deploy` |
| `APP_URL` | Public address used in email links and the Google redirect. Detected automatically on Vercel and Render |
| `APP_TIMEZONE` | Day boundary for streaks and daily quests (default `Asia/Karachi`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing email. Gmail: `smtp.gmail.com`, `465`, `true`, your address, an [App password](https://myaccount.google.com/apppasswords) |
| `MAIL_FROM` | Sender, e.g. `CampusQuest <you@gmail.com>` |
| `BREVO_API_KEY` | Alternative to SMTP: send through Brevo's HTTPS API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Continue with Google (button hidden when empty) |
| `ALLOWED_EMAIL_DOMAINS` | Optional: only allow sign-up from these domains, e.g. `uni.edu.pk` |
| `CRON_SECRET` | Protects the daily reminder endpoint on Vercel. Generated by `npm run deploy` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Optional: create a first admin on start-up if none exists |
| `SHOW_DEMO_ACCOUNTS` | Local only: show the demo logins on the login page |

## Deployment

### How the live site is set up

| Piece | Service (free) | Notes |
| --- | --- | --- |
| Web app + API | Vercel Hobby | `api/index.js` runs the Express API as a function in Mumbai (`bom1`); `public/` is served from the CDN |
| Database | MongoDB Atlas Free cluster | 512 MB, AWS Mumbai |
| Email | Gmail SMTP | About 500 emails/day on a personal Gmail account |
| Reminders | Vercel Cron | `/api/cron/reminders` once a day, between 09:00 and 10:00 Pakistan time |

`vercel.json` routes `/api/*`, `/verify` and `/reset` to the function and adds security headers to the page.
Secrets are stored on Vercel as encrypted, write-only environment variables.

### Publish changes

```powershell
npm run deploy
```

The script checks the Vercel login, uploads the settings from `.env` and `.env.production` (values are never printed),
and deploys to production. Pushing to GitHub does **not** deploy by itself. To deploy on every push instead,
connect the repository in Vercel → Project → Settings → Git (needs a GitHub login connection on your Vercel account).

### Set it up from scratch

1. **MongoDB Atlas**: create a free cluster, then:
   - add a database user with an auto-generated password;
   - under Network Access, allow `0.0.0.0/0`, because Vercel has no fixed IP address;
   - copy the connection string from Connect → Drivers, put the password in, and add `/campusquest` before the `?`.
2. Put it in `.env.production` as `MONGO_URI=...`, and fill in the email (and optionally Google) settings in `.env`.
3. Log in to Vercel once: `npx vercel@65.16.0 login`, then approve it in the browser.
4. `npm run deploy`. The first run creates the Vercel project and generates `JWT_SECRET` and `CRON_SECRET`.
5. Sign up on the live site, then run `npm run make-admin -- you@example.com --prod`.
6. In Google Cloud Console → your OAuth client, add:
   - Authorised JavaScript origin: `https://<your-site>.vercel.app`
   - Authorised redirect URI: `https://<your-site>.vercel.app/api/auth/google/callback`

   Then publish the OAuth consent screen so everyone can sign in, not just test users.

### Free-tier notes

- Vercel's Hobby plan is for personal, non-commercial projects. After a quiet period, the first request takes a
  second or two while the function starts and reconnects to the database.
- Atlas Free has no automatic backups; export important data from Atlas now and then.
- Never run `npm run seed` against the live database: the demo passwords above are public. The script refuses unless forced.

### Alternative: Render

`render.yaml` deploys the same app on Render's free plan (Dashboard → New → Blueprint). Render's free plan blocks
SMTP ports, so set `BREVO_API_KEY` (Brevo: 300 free emails/day) instead of the Gmail settings. Free Render services
sleep after 15 minutes without visitors, and the next visit takes about a minute.

## Authentication flows

| Flow | How it works |
| --- | --- |
| Sign up with email | `POST /api/auth/register` stores a *pending* sign-up (password already hashed) and emails a 6-digit code and a link. **No account exists until one of them is used** (`POST /api/auth/verify-code` or `/verify?token=…`). Single use, 24-hour expiry; a code locks after 5 wrong tries. |
| Log in | Only verified accounts can log in. Logging in before verifying (with the right password) leads to the code screen. |
| Continue with Google | OAuth 2.0 authorization code flow with PKCE, `state` and `nonce`; Google must report the email as verified. Sign-up page: creates the account with the chosen role. Login page: signs in to an existing account, or asks for the role before creating one. An existing account with the same email is linked to Google. |
| Forgot password | Emails a single-use link valid for 1 hour. Resetting signs out every other session. |
| Admin creates a user | The user gets a 72-hour invitation to set their own password, which also verifies the email. |
| Change password | Needs the current password (unless the account only uses Google) and signs out other devices. |

## Tests

```powershell
npm test
```

47 tests run against a separate `campusquest_test` database; set `TEST_MONGO_URI` to use another one. They never send real email.

They cover the SRS test cases, including:
- duplicate-XP prevention (TC-008, TC-012)
- quiz attempt limits (TC-010)
- role boundaries (TC-004, TC-018)
- validation (TC-019)
- streak and level rules, leaderboard privacy and analytics

They also cover:
- email verification, codes and lockout
- invitations and session revocation
- Google sign-in for both buttons, including forged or expired attempts
- the Brevo email transport, the Vercel entry point and the cron authorisation
- CSV question import

## How the SRS maps to the code

| SRS area | Where |
| --- | --- |
| Auth, RBAC, password reset (FR-001..010), email verification, Google sign-in | `server/routes/auth.js`, `server/middleware/auth.js`, `server/services/mailer.js`, `server/services/authTokens.js` |
| Profiles (FR-011..018) | `server/routes/users.js` |
| Courses, enrollment (FR-019..028) | `server/routes/courses.js`, `server/lib/access.js` |
| Modules & lessons, progress (FR-029..047) | `server/routes/content.js`, `server/services/progress.js` |
| Quizzes (FR-048..066) | `server/routes/quizzes.js`, CSV import in `public/js/csv.js` |
| Quests (FR-067..080) | `server/routes/quests.js`, `server/services/quests.js` |
| XP & levels (FR-081..090) | `server/services/gamification.js`, `server/lib/levels.js` |
| Achievements (FR-091..099) | `server/services/achievements.js` (conditions are data, 8 defaults in `services/defaults.js`) |
| Streaks (FR-100..107) | `server/services/streaks.js`, `server/lib/dates.js` |
| Leaderboards (FR-108..115) | `server/routes/gamification.js` |
| Notifications (FR-116..123) | `server/routes/notifications.js`, `server/services/scheduler.js` |
| Instructor analytics (FR-124..132) | `server/routes/instructor.js` |
| Admin (FR-133..140) | `server/routes/admin.js`, `server/services/audit.js` |

The REST endpoints follow SRS section 10. Endpoints added where the UI needed them:
- question CRUD (`/api/quizzes/:id/questions`, `/api/questions/:id`)
- `/api/quizzes/:id/abandon`
- module and lesson reorder
- course announcements
- `/api/users/history` and `/api/users/password`
- the admin endpoints

### Reward integrity (the core design rule)

- **XP is created only on the server**, by `awardXp()`. The client never sends an XP value.
- **Duplicates pay nothing.** Every reward has a fixed `eventKey`, such as `lesson:<id>:<student>` or
  `quest:<id>:<student>:<period>`, and `xpTransactions.eventKey` has a **unique index**. A duplicate or
  simultaneous request hits that index and is rejected (FR-078, FR-089, NFR-026). A test fires five requests at once.
- **Quiz answers stay on the server.** Quizzes are graded there, and questions reach the browser without the correct answers.
- **A failed reward undoes the lesson completion,** so nothing is wrongly shown as complete.

### Decisions made where the SRS left choices open

| Question the SRS raised | Decision |
| --- | --- |
| Reward stacking | Separate events, each with its own key: lesson, module, quest, streak milestone, quiz pass, quiz bonus. |
| Quiz rewards | Pass XP and the 90% bonus are granted **once per quiz** (first qualifying attempt). Retakes are recorded without XP. |
| Quiz timing | The attempt limit counts submitted attempts. Leaving a quiz discards it; a timed-out attempt is graded automatically. Answers arriving more than 60 s after the timer are ignored. |
| Streak timezone & reset | `APP_TIMEZONE` (default `Asia/Karachi`, editable in Admin → Settings). One streak day per calendar day; a missed day resets to 1; the longest streak is kept. |
| Enrollment policy | Open by default; instructors can close enrollment or require a code. |
| Level formula | `100 × L × (L−1) / 2` (SRS 6.4), base configurable. |
| Daily / weekly quests | Repeat each day / ISO week until their deadline; one reward per period. |
| Leaderboard | Ranked by total XP among students enrolled in the course. Students can opt out and appear as "Anonymous learner". |
| Instructor sign-up | Allowed (UC-01), but admins can switch it off. Admin accounts are never self-registered. |

## Security notes

- **Passwords and sessions:**
  - passwords are hashed with bcrypt (cost 12)
  - sessions are a JWT (HS256) in an `httpOnly`, `SameSite=Lax`, `Secure` cookie
  - changing or resetting a password revokes every older session
- **Email links and codes:** only a hash is stored, each works once, and MongoDB deletes them automatically when they expire.
- **Every API route checks:**
  - authentication and role
  - ownership: instructors can change only their own courses
  - input, validated on the server with zod
- **Account changes apply at once,** because each request reloads the account; this covers suspensions and role changes.
- **Rate limits and privacy:** login, sign-up, reset and email endpoints are rate-limited. They don't reveal whether an
  email has an account; the exception is sign-up, which has to say "already registered".
- **Other protections:**
  - Content-Security-Policy and other security headers, on the API and on the page
  - an Origin check on every write request
  - escaped search input and output
  - only safe link types allowed in lessons
- **Production secrets** are write-only environment variables on Vercel and are never committed. The cron endpoint needs `CRON_SECRET`.
- **Audit log:** role and status changes, course status, settings, announcements, deletions and sign-ups are recorded.

## Known limitations

- Lesson content is formatted text; files are attached as links (FR-035).
- No automatic database backups on the free Atlas tier (NFR-028).
- Deadline reminders run once a day on Vercel's free plan.
- Accounts that existed before email verification was added count as already verified.
- Out of scope per SRS section 14: AI features, live video, native apps, payments, offline sync.
