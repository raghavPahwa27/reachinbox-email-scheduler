# Configure and run ReachInbox

Run commands from the folder containing `package.json` and `docker-compose.yml`. On this computer that is the inner `reachinbox-email-scheduler-main` folder.

## 1. Prepare the local configuration

```sh
npm ci
npm run setup
```

Open `backend/.env`. Fill in the Google, Slack and Ethereal fields below. `setup` already generated session and encryption secrets and will preserve them on later runs. Do not put backend credentials into frontend variables or commit environment files.

## 2. Google login

1. Select your project in Google Cloud Console and open Google Auth Platform.
2. Configure branding, External audience and a contact email.
3. Create a client with application type **Web application**.
4. Register the exact redirect URI `http://localhost:3001/api/auth/google/callback`.
5. Copy the matching client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.
6. In Audience → Test users, add the Google email you will use to sign in. If using somebody else's client, their project must include your test user and the required redirect URI.

Official reference: [Google OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect).

## 3. Ethereal

1. Create a test account at [Ethereal](https://ethereal.email/create).
2. Put the SMTP username and password in `ETHEREAL_USER` and `ETHEREAL_PASS`.
3. Leave host `smtp.ethereal.email` and port `587` unchanged.
4. After login, open **Sending accounts**, add a sender name and From email. Leave its SMTP fields blank to use the environment account, or supply a separate Ethereal account for each sender.

Ethereal stores fake test mail and supplies preview links; it does not deliver to real recipients.

## 4. Start services and application processes

Install and open Docker Desktop with its Linux/WSL 2 engine running.

```sh
docker compose up -d --wait
npm run db:generate
npm run db:migrate
```

In three terminals:

```sh
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open `http://localhost:5173` and click **Continue with Google**. You need both the API and worker running. Run `npm run doctor` to check configuration and connectivity without displaying secrets. Add your Google email to `ADMIN_EMAILS` and restart the API to access the queue dashboard from the account menu.

## 5. Slack OAuth and the HTTPS tunnel

[Slack's OAuth documentation](https://docs.slack.dev/authentication/installing-with-oauth/) requires an HTTPS redirect URI. A new Slack application cannot rely on the local HTTP callback example in older configurations.

1. Use an HTTPS tunnel to local port **5173**, for example an ngrok tunnel. Copy its public HTTPS origin.
2. Update these three entries in `backend/.env`, using your real tunnel hostname:

```dotenv
FRONTEND_URL=https://YOUR-TUNNEL-HOST
GOOGLE_CALLBACK_URL=https://YOUR-TUNNEL-HOST/api/auth/google/callback
SLACK_REDIRECT_URI=https://YOUR-TUNNEL-HOST/api/slack/callback
```

3. Register the new Google callback in the same Google client's authorized redirect URIs.
4. In your Slack app's OAuth & Permissions, register the new Slack callback and add the **bot** scope `chat:write`.
5. Copy the Slack client ID and client secret from Basic Information → App Credentials into `backend/.env`. A signing secret or bot token is not a client secret.
6. Restart API and frontend. Permit only your tunnel hostname in Vite. PowerShell example, in the frontend terminal:

```powershell
$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'YOUR-TUNNEL-HOST'
npm run dev:web
```

7. Open the **HTTPS tunnel URL** and sign in again there. Use this same origin throughout so the OAuth session cookie is available on callbacks.
8. Click Slack → Connect Slack. Supply your notification channel ID from Slack's channel details, then complete the real authorization flow.
9. Invite the installed bot to that channel. Set a sender/batch cap of 1 and schedule 2 recipients. The first admission generates the live notification; the remaining message is delayed to the next UTC hour.
10. Disconnect and reconnect from the dashboard to verify the stored integration changes without redeploying the worker.

No local Slack token or webhook is fabricated. If the OAuth app belongs to another person, that person must configure its callback and allow installation.

## 6. Checks and submission

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
npm run test:integration
```

The integration command uses separate disposable test containers and synthetic accounts. The browser tests use controlled HTTP fixtures. Neither replaces the real Google consent, Slack notification and Ethereal preview checks required for the demo. See [the checklist](ASSIGNMENT-CHECKLIST.md) and [demo guide](DEMO.md).
