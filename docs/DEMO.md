# Five-minute demo recording guide

Record the real application and provider results, not the browser test fixtures. Hide environment files, credentials, session cookies and tokens. Use fake recipient addresses from [demo-leads.csv](../examples/demo-leads.csv); Ethereal does not deliver them to real inboxes.

Before recording: start all services/processes; log in through Google; create an Ethereal sender; connect Slack and invite the bot to the chosen channel. Allow your login email through `ADMIN_EMAILS`, then restart the API. Choose a sender cap of **2**, delay **2 seconds**, and a batch of **3** recipients.

| Time | Show |
| --- | --- |
| 0:00–0:30 | Google login, name/email/avatar, Scheduled and Sent screens |
| 0:30–1:10 | Compose subject/body, upload CSV and show 3 detected leads; choose a start about one minute ahead, two-second delay and cap 2 |
| 1:10–1:45 | Schedule; show the 3 database-backed rows and live delayed jobs in Bull Board |
| 1:45–2:15 | Stop API and worker, keeping Docker services running; start both again; inspect the same delayed job IDs |
| 2:15–3:00 | Refresh Sent; inspect real sent times and open an Ethereal preview. The third email remains scheduled for the next UTC hour |
| 3:00–3:40 | Open Slack and show the actual hourly-limit notification in the connected channel |
| 3:40–4:15 | Search the unique subject, open a message, demonstrate sender/account controls and Slack disconnect/reconnect |
| 4:15–4:50 | Restart once more and show SENT rows stay terminal; briefly explain Redis persistence, hourly admission and the SMTP acceptance/DB-commit ambiguity |

If SMTP or OAuth fails, resolve the error before recording the final video. Do not label a failed/log-only notification as live Slack delivery. Avoid waiting for the next hour during the recording: displaying the deferred job timestamp demonstrates that part of the behavior.

Stop/restart the API/worker through their terminal sessions or the process manager you used to launch them. Do not delete Docker volumes. Keep the final video under five minutes and add its URL to the submission README.
