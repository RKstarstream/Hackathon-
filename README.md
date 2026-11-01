# Tech Tank Hackathon website

The public event site is a scroll-driven 3D journey. It opens on a powered-off laptop, the lid opens as you scroll, code runs on the screen, and the camera moves to a new angle for each topic: mission, tracks, the twist, the sealed Question Card, timeline, rules, and registration. On phones, readable stacked sections and a swipeable menu sit over the animated background. After the journey, the page scrolls through announcements, the twist status, qualifiers, results and the FAQ. The tentative schedule includes four hours of building and closing around 4:30 PM.

It also has a live **Control Room** for running the event. No build step and no packages to install. You only need Node.js 18 or newer.

## Start it

```bash
cd tech-tank-site
node server.js
```

- Website: http://localhost:3000
- Control Room: http://localhost:3000/admin
- Default passcode: `techtank2026`

To change the passcode or port:

```bash
ADMIN_PASSCODE="your-secret" PORT=8080 node server.js
```

On Windows PowerShell: `$env:ADMIN_PASSCODE="your-secret"; node server.js`

## GitHub

The public 3D event website is exported into `docs/` for GitHub Pages. Run `npm run build:pages` after public content or design changes, then commit and push the updated `docs/` files. Pages uses `main` and `/docs`. The export keeps sealed questions/twists and unpublished scores out of its JSON, and includes no private accounts or proofs. GitHub Pages displays event information and animation; account registration, payment uploads and admin tools require the Node server.

The project can be kept in a GitHub repository. The included GitHub Actions workflow runs the tests on pushes and pull requests. There is no dependency installation or build step. `.env.example` documents server settings; real credentials, participant accounts, payment proofs, logs and backup data are excluded by `.gitignore`.

Create an empty repository on GitHub, then run these commands from this folder, replacing the example URL with your repository URL:

```bash
git add .
git commit -m "Add Tech Tank website"
git remote add origin https://github.com/YOUR_USERNAME/tech-tank-site.git
git push -u origin main
```

Keep runtime participant data and uploaded payment proofs on persistent host storage, outside Git. Check public assets and event content before publishing the repository. GitHub stores the source; the complete website requires a Node.js host because GitHub Pages cannot run its server, account APIs or private uploads. A Node hosting service can deploy from this repository with `npm start`; configure secrets in its dashboard. The Google Apps Script integration remains optional.

To let phones on the same Wi-Fi open the site, use your computer's local IP, e.g. `http://192.168.1.20:3000`. To put it on the internet, deploy the folder to any Node host (Render, Railway, a VPS) and run `node server.js` there.

## Running the event from the Control Room

| Tab | What it does |
| --- | --- |
| Live control | Switch the event phase badge, broadcast a full-screen alert (with sound) to every open screen, post ticker announcements, show or hide results |
| Participant portal | Set presentation and Q&A timings, preparation notes, submission link, extra parameters, welcome message and results notice |
| Participant accounts | View registered accounts, link each to an official team, update qualification/progress status and publish a private portal note |
| Results | Score every team per criterion (out of 10). Totals and ranks update instantly. Add winners. Turn on **Auto-publish** while judging and the public leaderboard re-orders live |
| Media | Drag and drop photos or videos, or paste a YouTube or image link. Uploads go live straight away |
| Teams | Teams used for scoring and the results board |
| Question card | The question and its reveal time. It stays sealed for the public until then (the server never sends it early). "Reveal to everyone now" flips it on every screen |
| Qualifiers | Paste the qualified teams. Turn on "Show" and they appear with a search box |
| Rules & judging | Edit rules and the judging criteria and weights |
| Schedule | Sessions per day. The site highlights what is happening now |
| Event details | Name, theme, dates, venue, registration link, deadline and open/closed switch |
| Tracks, The twist, FAQ & organisers | Everything else on the page |
| Raw data | Edit or back up all content as JSON |

Changes are drafts until you press **Publish** (or Ctrl/Cmd + S). Phase changes, alerts, announcements and media uploads publish immediately. Every open copy of the website updates within a second, no refresh needed.

Published rules, judging descriptions and weights, event information, schedule, tracks and FAQ appear on the participant site. Reconnecting viewers receive the latest content immediately; a 15-second background check also recovers updates if streaming is unavailable. Returning to the tab or reconnecting to the internet triggers a refresh. Unpublished drafts remain in the Control Room. Qualifiers and results require their visibility switches, and the question stays sealed until its reveal.

## Participant accounts and portal

Optional Google integration: see [Google Apps Script setup](integrations/google-apps-script/README.md) to copy new registrations to Sheets and payment screenshots to Drive. Configure the server environment variables to enable it.

- `/register`: each participant registers with their name, team name, email and password, pays ₹150 using the displayed QR code, and supplies a transaction ID and payment screenshot (PNG/JPG/WebP, up to 5 MB). Payment is marked pending review; organisers confirm it manually. Registration follows the admin open/closed switch and deadline. Existing accounts can still sign in without resubmitting payment.
- **Participant accounts** shows payment amounts and transaction IDs and provides an authenticated **Download payment proof** button. Screenshots are stored in `data/payment-proofs/`, outside public assets and excluded from Git. Keep this directory on persistent storage and include it in private account backups.
- `/login`: sign in and go directly to `/portal`, with the question selected. The TT logo at the top right opens the main website; its **My portal** button returns to the portal. Sessions survive navigation and server restarts for seven days.
- The portal has separate tabs for the question, twist, presentation, rules and judging, schedule, and personal results. Question and twist instructions are withheld by the server until their reveal time or manual release. Shared announcements and alerts appear automatically.
- In **Participant accounts**, select an official team from **Teams**, choose a status, add an optional private note, and click **Save participant update**. These account updates go live immediately. Account creation never grants access to an existing team just because its name matches.
- Use **Participant portal** to edit presentation duration, Q&A duration, instructions and parameters, then **Publish**. In **The twist**, edit release instructions and scenarios; assign scenarios in **Teams**. Choose a reveal time and **Schedule publication**, or **Reveal twist now**. **Unpublish twist** hides its content and linked assets immediately, even after the saved reveal time. The saved schedule remains disabled until scheduled again.
- Gallery cards open detail widgets with current event content. In **Media**, choose each card's **Widget content** (theme, event information, twist, question, rules, presentation, schedule, results or media details). Twist cards show a locked placeholder before publication. Open widgets update when admins publish or unpublish content.
- Team scores and rank appear only after linking the account to its official team and turning on results publication in **Results**. The public qualified-team list and an account’s individual status are separately controlled.
- Passwords use salted scrypt hashes. Session cookies are HttpOnly and SameSite=Lax; stored session tokens are hashed. Accounts and sessions live in `data/participants.private.json`, outside public assets and excluded from Git. Back up this private file securely alongside event content, and retain it on persistent storage when hosting. Run one Node instance for this file-backed application.
- Deploy behind HTTPS. Set `COOKIE_SECURE=1` in production when your host does not forward the HTTPS protocol. Accounts do not currently include email verification or self-service password recovery.
- `npm test` runs isolated tests without editing real participant data or event content.

## Source files

- `data/content.json`: all site content. The Control Room edits this file. A copy of the last publish is kept in `data/content.backup.json`.
- `public/uploads/`: uploaded media.
- `public/index.html`, `world.css`, `world.js`: the 3D site. `public/vendor/three.min.js` is Three.js r128 (MIT), bundled so it works offline.
- `public/admin.html`, `admin.js`: the Control Room.
- `server.js`: the zero-dependency Node server.
- `render-start.js`: deployment entry point for hosts with persistent storage at `/var/data/tech-tank`.
- `apps-script-sync.js` and `integrations/google-apps-script/`: optional Google Sheets and Drive integration and setup instructions.
- `tests/`: isolated regression tests; run with `npm test`.
- `participants.js`: account authentication, private account management and authenticated portal API.
- `public/account.html`, `account.js`, `portal.html`, `portal.js`, `portal.css`: registration, login and participant portal.

## What is placeholder

The question, rules, schedule timings, dates, the six teams and their scores, and the three gallery images are samples so the site looks complete. Replace or delete them from the Control Room (Teams tab has "Remove all teams").
