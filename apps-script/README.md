# Tech Tank on Google Apps Script

This folder is the complete website as a Google Apps Script web app: the 3D event site, registration with payment proof, participant sign in and portal, and the Control Room. No server or hosting account is needed, only a Google account. Data stays in your own Google Drive.

| Page | Address |
| --- | --- |
| 3D event website | `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` |
| Create an account | `…/exec?page=register` |
| Participant sign in | `…/exec?page=login` |
| Participant portal | `…/exec?page=portal` (sections can be linked directly, e.g. `?page=portal#rules`) |
| Control Room | `…/exec?page=admin` |

Links between pages work automatically. Unknown pages show a "Page not found" message with a link home.

## Files

| File | What it is |
| --- | --- |
| `Code.gs` | Server: page routing, storage, accounts, sessions, uploads and the API |
| `Seed.gs` | The starting event content (generated from `data/content.json`) |
| `Index.html` | 3D event website |
| `Account.html` | Register and sign in |
| `Portal.html` | Participant portal |
| `Admin.html` | Control Room |
| `appsscript.json` | Project settings (time zone, web app access) |

`Index.html`, `Account.html`, `Portal.html`, `Admin.html` and `Seed.gs` are generated from the website in `public/`. After changing the website, run `npm run build:apps-script` and upload the files again. Do not edit them directly. `Code.gs` and `appsscript.json` are edited here.

## Deploy (copy and paste, about 10 minutes)

1. Open https://script.google.com and click **New project**. Rename it "Tech Tank".
2. Click **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file in editor**.
3. In the editor, replace the contents of `appsscript.json` with this folder's `appsscript.json`.
4. Replace the contents of `Code.gs` with this folder's `Code.gs`.
5. Add the other files with **+ → Script** or **+ → HTML**, using exactly these names (the editor adds the extension): `Seed` (script), `Index`, `Account`, `Portal`, `Admin` (HTML). Paste each file's full contents and save (Ctrl+S).
6. Select `setup` in the function menu at the top and click **Run**. Approve the Google permissions (Drive for data and uploads, Sheets for the registrations sheet). Google may show "Google hasn't verified this app": choose **Advanced → Go to Tech Tank** because it is your own script.
7. Open the **Execution log**. It shows your **admin passcode**, the data folder and the registrations sheet. Keep the passcode private.
8. Click **Deploy → New deployment**, choose the type **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. Copy the web app URL ending in `/exec`.
9. Open the URL. Open `…/exec?page=admin`, sign in with the passcode, and check **Event details** (registration deadline, dates, venue) before sharing the link.
10. Optional: to make the Register and Sign in buttons on the GitHub Pages site open these pages, put the `/exec` URL in `pages.config.json` at the project root (`{ "webAppUrl": "https://script.google.com/macros/s/…/exec" }`), run `npm run build:pages`, and push.

### Deploy with clasp instead

1. Create an empty project at https://script.google.com and copy its **Script ID** from **Project Settings**.
2. In this folder, create `.clasp.json` containing `{ "scriptId": "YOUR_SCRIPT_ID", "rootDir": "." }`. It is kept out of Git.
3. Run:

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

```bash
clasp push --force
```

Run `clasp push --force` from inside `apps-script/`. `--force` replaces the project's manifest with this folder's `appsscript.json`. Then run `setup` in the editor and create the web app deployment as in steps 6 to 8.

### Updating the live site

After changing files, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The `/exec` address stays the same. A brand-new deployment gets a new address.

## Running the event

Everything in the main README's Control Room table works the same way. Changes made in the Control Room reach every open page within about 5 seconds (pages check for updates every 5 seconds while they are open and visible). Broadcast alerts, the question reveal, the twist reveal and participant status updates all appear without a refresh.

## Where the data lives

`setup()` creates a private Drive folder, **Tech Tank Hackathon data**:

- `content.json`: all event content. `content.backup.json` holds the previous publish.
- `participants.private.json`: accounts and sessions. Passwords are stored as salted PBKDF2-SHA256 hashes, and session tokens are stored hashed.
- `payment-proofs/`: payment screenshots. Private to you. Download them from **Participant accounts**.
- `media/`: Control Room uploads. Each file is shared as "anyone with the link can view" so it can appear on the site.
- **Tech Tank registrations** spreadsheet: one row per registration, with the payment reference and proof link. Status, linked team and organiser note update when you save a participant in the Control Room.

Keep the folder private. If you edit `content.json` or `participants.private.json` directly in Drive, run `refreshCache` from the editor afterwards so the site picks up the change.

## Settings (Project Settings → Script properties)

| Property | Purpose |
| --- | --- |
| `ADMIN_PASSCODE` | Control Room passcode. `setup()` creates a random one. Change it here at any time. |
| `WEB_APP_URL` | Optional. Set it to your `/exec` URL if links between pages ever point to the wrong deployment. |
| `DATA_FOLDER_ID`, `CONTENT_FILE_ID`, … | Created by `setup()`. Do not change. |

To move existing content from the Node version, open the Control Room, go to **Raw data**, paste the contents of `data/content.json`, click **Apply** and **Publish**. Participant accounts from the Node version cannot be moved, because Apps Script cannot check their password hashes. Participants register again.

## Differences from the Node server

- Live updates arrive within about 5 seconds rather than instantly.
- Control Room uploads are limited to 20 MB per file. Add larger videos as YouTube or Google Drive links. Uploaded images and videos are stored in Drive and need link sharing; some Google Workspace organisations block it, in which case use public image or YouTube links.
- Participant sessions are kept in the browser's site storage instead of a cookie. Signing out, or clearing site data, ends the session.
- Sign-in attempts are limited per email address (Apps Script cannot see visitor IP addresses).
- After registering or signing in, the portal opens automatically. If the browser blocks the automatic move, a button opens it.

## Limits to know

Google Apps Script allows about 30 requests to run at the same time for one account. Each open page checks for updates every 5 seconds, which suits a typical college event (a few hundred open screens). For much larger audiences, raise `TT_POLL_MS` at the top of `Code.gs` (for example to 10000) and create a new version.

Google Workspace accounts: your administrator must allow web apps that "Anyone" can access. Personal Gmail accounts allow it by default.

## Try it locally first

`npm run preview:apps-script` runs these exact files on your computer with an in-memory copy of Google's services, inside a sandboxed frame like Apps Script uses. Open http://localhost:8787/exec. The admin passcode is printed in the terminal. Data is discarded when the preview stops.
