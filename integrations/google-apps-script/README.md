# Google Apps Script registration integration

New registrations can be copied to Google Sheets, with payment screenshots in a private Drive folder. The Node server remains required for accounts, login, private files and live updates; this does not host the website inside Apps Script. No Google connection is enabled by default.

## Set up Google

1. Create a Google Sheet and a private Drive folder for payment proofs. Copy their IDs from their URLs. Use a dedicated folder with access limited to organisers.
2. Create a project at https://script.google.com and paste `Code.gs` into its editor.
3. In **Project Settings → Script Properties**, add `SPREADSHEET_ID`, `PROOF_FOLDER_ID`, and `SHARED_SECRET`. Use a random secret of at least 32 characters. Generate one locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it out of source files and browser code.
4. Choose **Deploy → New deployment → Web app**. Execute as **Me**. Choose **Anyone** for access so the Node server can POST without a browser login. The script rejects requests without the secret and exposes no read endpoint. Authorise Sheets and Drive access in your Google account. If your organisation does not permit this deployment mode, an administrator must enable a suitable deployment before this integration can be used.
5. Copy the deployment URL ending in `/exec`, not the development `/dev` URL. After editing the script, update the deployment to a new version.

## Configure the website server

Set these environment variables in the host's dashboard (for example Render) and restart the server:

```text
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
APPS_SCRIPT_SECRET=the-same-value-as-SHARED_SECRET
```

For local PowerShell, set `$env:APPS_SCRIPT_URL` and `$env:APPS_SCRIPT_SECRET` in the terminal before running `npm start`. The application does not automatically read `.env` files.

Submit a new test registration on your website. Check the **Registrations** sheet and the proof folder. Rows contain the registration ID, date, name, email, team, ₹150 amount, transaction reference, pending-review status and proof link. Passwords, password hashes, session tokens and private admin notes are never sent.

Registrations save locally first. Google sync runs in the background, retries every minute, and resumes pending entries after restart. Repeated requests are deduplicated by registration ID. Keep `data/` on persistent storage. Only registrations created while integration is configured are queued; older accounts are not exported automatically. Changes made later in the admin panel or Sheet do not sync in either direction. Proof and registration access follows your Google folder and spreadsheet permissions.

To disable sending, remove both variables and restart. Pending data stays local. Do not post secrets in chat or add them to Git.

Reference: https://developers.google.com/apps-script/guides/web and https://developers.google.com/apps-script/guides/content
