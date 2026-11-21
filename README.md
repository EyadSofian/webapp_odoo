# Engosoft Learn — the learner app

A mobile-first web app (PWA) for Engosoft's Odoo portal users: their live and recorded courses, sessions, recordings and files,
certificates, a real-time group per live course, and push notifications. Buying is not in the app: anything sales-related links to
engosoft.com.

```
web/      React + Vite + Tailwind PWA (Arabic RTL first, English too, light and dark)
backend/  ASP.NET Core 10 minimal API + SignalR + PostgreSQL (EF Core)
docs/     Odoo field map from the analysis
```

Odoo (17 Enterprise, database `EngoSoft`) stays the source of truth. The phone never talks to Odoo: the backend reads Odoo as an
integration user and answers each learner with their own data only.

## Run it locally

Prerequisites: .NET 10 SDK, Node 20+, Docker.

1. Database:

   ```bash
   docker compose up -d db
   ```

2. Backend secrets (stored outside the repo with .NET user secrets):

   ```bash
   cd backend/src/Engosoft.Learn.Api
   dotnet user-secrets set "Odoo:IntegrationUid" "<odoo user id>"
   dotnet user-secrets set "Odoo:ApiKey" "<odoo api key of that user>"
   dotnet user-secrets set "Webhooks:Secret" "$(openssl rand -hex 24)"
   dotnet user-secrets set "Bunny:StreamTokenKey" "<Bunny Stream token authentication key>"
   ```

3. Backend (applies migrations on start, listens on http://localhost:5080):

   ```bash
   cd backend/src/Engosoft.Learn.Api && dotnet run
   ```

4. Web app (http://localhost:5173, proxies `/api` and `/hubs` to the backend):

   ```bash
   cd web && npm install && npm run dev
   ```

Sign in with an Odoo portal account (same email and password as the website). In development only, the login screen also has a
"sign in as partner id" box (`Dev:AllowImpersonation`), so you can see the app as a real learner or instructor without their password.

Tests:

```bash
cd backend && dotnet test
```

## What is in v1

- **Sign-in** with the learner's Odoo credentials; the backend issues its own short-lived token and a rotating refresh token, and
  re-checks the Odoo account on every refresh. Instructors (internal users marked `is_instructor`) sign in the same way.
- **Home**: next session with countdown and Join button (opens 15 minutes before), upcoming sessions, continue learning, live courses,
  certificates.
- **Live courses** (`event.event`): sessions (`event.track`), Zoom join, recordings (Bunny), files the instructor uploaded
  (Zoom chat exports and captions are never shown to learners), attendance, access expiry.
- **Recorded courses** (`slide.channel`): sections and lessons, video (Bunny, signed by Odoo), articles, documents, mark as done.
  Quizzes open on the website for now.
- **Groups**: one group per live course, members synced from Odoo registrations (valid seat = `open`/`done` and not expired) plus the
  instructor and coordinators. No private messages between learners; a learner can open a private question that the whole course
  team sees. Replies, reactions, files and images, pinned messages, "approved answer", announcement-only mode, slow mode, mute,
  report, audit log. Groups turn read-only 14 days after the last session.
- **Notifications**: Web Push (VAPID) for session reminders (about a day before, one hour before, and at start), team replies,
  mentions, schedule changes, recordings and files; in-app inbox; quiet hours; per-group level.

## Odoo setup for production

1. **Integration user**: create a dedicated internal user for the app (not an admin). It needs read access to `event.event`,
   `event.registration`, `event.track`, `event.track.document`, `slide.channel`, `slide.channel.partner`, `slide.slide`,
   `slide.slide.partner` (read + write + create, for "mark as done"), `lms.certificate`, `hr.employee`, `hr.coordinator`,
   `res.users`, `res.partner`, `product.product`, `week.day`. Generate its API key and put both in the backend configuration.
2. **Webhooks**: in Settings → Technical → Automation Rules, add rules with the action *Send Webhook Notification* pointing at
   `https://<api host>/api/webhooks/odoo/<Webhooks:Secret>/<kind>`:

   | Kind               | Model                  | Trigger                                    |
   |--------------------|------------------------|--------------------------------------------|
   | `registration`     | `event.registration`   | on create and on update of `state`         |
   | `session-changed`  | `event.track`          | on update of `date`                        |
   | `recording-ready`  | `event.track`          | on update of `zoom_recording_status` to completed |
   | `document-added`   | `event.track.document` | on create                                  |

   The backend re-reads each record from Odoo; the payload is only used for its id. Without webhooks, groups still resync every
   15 minutes and reminders still run every minute.
3. **Bunny**: set `Bunny:StreamTokenKey` to the Bunny Stream token authentication key (the one in Odoo's eLearning settings) so
   live-session recordings can be signed. Without it the app sends learners to the website for those recordings.
   If Bunny restricts allowed referrers, add the app's domain there.
4. **Instructors without Odoo users** (37 of 86 at the time of the analysis) cannot join groups until they get a user.

## Deploy

### Railway (one service + PostgreSQL)

The repository has a `Dockerfile`: Railway builds the web app, publishes the API, and serves both from one container on
`$PORT`. The service settings (Dockerfile builder, health check on `/alive` with a 120 s timeout, restart on failure up to
5 times, the `/app/storage` volume mount) live in `.railway/railway.ts`. Railway does not read that file on deploy: after
changing it, run `npm install` once at the repository root, then `railway config plan` to review and `railway config apply`
to write the settings to the service (expect a redeploy). Variables are not managed there and stay in Railway.
Add a PostgreSQL service and reference its `DATABASE_URL` from the app service (the backend converts it).
Set `Auth__SigningKey`, `Odoo__IntegrationUid`, `Odoo__ApiKey`, `Webhooks__Secret`, and optionally `Bunny__StreamTokenKey`
and `OpenAI__ApiKey`. Mount a volume at `/app/storage` so chat files and task submissions survive redeploys.

### Anywhere else

- Build the web app (`cd web && npm run build`) and either host `web/dist` on any static host or copy it to
  `backend/src/Engosoft.Learn.Api/wwwroot`, which the backend then serves (one deployment, same origin, no CORS).
- Production configuration (environment variables use `__`, for example `Odoo__ApiKey`): `ConnectionStrings__Default`,
  `Auth__SigningKey` (32+ random bytes), `Odoo__*`, `Bunny__StreamTokenKey`, `Webhooks__Secret`, `Push__Subject`,
  optionally fixed `Push__PublicKey`/`Push__PrivateKey` (otherwise generated once and stored in the database),
  `Cors__Origins` when the web app is on another domain.
- HTTPS is required for service workers and push. The app expects a single backend instance (chat membership locks are in memory);
  scaling out needs a SignalR backplane (Redis) and a database-level unique key on course groups.
- iPhone: Web Push works only after "Add to Home Screen" (iOS 16.4+). The app shows the steps. For delivery on par with WhatsApp
  on iOS, wrap the same app with Capacitor and use native push.

## Known gaps

- The analysis found portal record rules in Odoo itself that need tightening (details in the private analysis document). The app
  never relies on them: it reads through the integration user and checks each learner's access on its own.
- Joining from the app returns the Zoom link but does not write `event.track.attendance`; attendance still comes from Zoom reports.
- Quizzes, tasks with grading, the AI tutor and WhatsApp fallback are the next phases.
