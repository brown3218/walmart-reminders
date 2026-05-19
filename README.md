# Walmart Reminders

Local-first Mac mini app that watches Apple Reminders grocery lists, matches items against Walmart reorder/search candidates, and exposes a phone-first dashboard for approving, adding, and cleaning up Walmart shopping items.

The runtime is local to the Mac. Codex is only used to build the app. Walmart login uses a persistent local Playwright profile under `var/walmart-profile`; the app never stores your Walmart password and never bypasses CAPTCHA, 2FA, robot checks, press-and-hold challenges, or manual verification.

## Setup

```sh
npm install
cp config.example.yaml config.yaml
npm run build
npm test
npm run doctor
npm start
```

In another terminal:

```sh
npm run url
```

Open the printed iPhone LAN URL from Safari while the iPhone is on the same Wi-Fi.

## iPhone Home Screen

The easy local mode is HTTP:

```text
http://<detected-LAN-IP>:3789
http://mac-mini.local:3789
```

In Safari on iPhone, open the URL, tap Share, then Add to Home Screen. The dashboard works over HTTP for normal use and bookmarking.

Service workers require a secure context. For full PWA app-shell caching, enable the optional HTTPS config after creating local certificates:

```yaml
dashboard:
  https:
    enabled: true
    port: 3790
    certPath: ./var/certs/cert.pem
    keyPath: ./var/certs/key.pem
```

Then restart and use the HTTPS URL printed by `npm run url`.

## Apple Reminders

Default list names:

- `Walmart`
- `Walmart shopping`
- `Walmart shopping list`

The first run may prompt for Reminders permission. Grant access to Terminal, Node, or the launched service when macOS asks. The default cleanup behavior completes reminders rather than deleting them:

```yaml
reminders:
  fulfillAction: complete
  deleteAction: complete
  pollSeconds: 60
```

If `npm run doctor` reports `No configured Reminders list was found`, create one of the configured lists in Apple Reminders or update `config.yaml`.

The app prefers the Swift/EventKit `reminderctl` helper when it has been built, and falls back to AppleScript if it is not available:

```sh
npm run reminders:build
```

## Walmart Session

Open a visible Walmart browser profile:

```sh
npm run walmart:login
```

Log in manually, complete any verification, then close the browser window. The app reuses that local profile for future Walmart reorder/search/add attempts.

Walmart automation uses a local profile lock at `var/walmart-profile.lock` so the service, CLI sync commands, and visible login window do not open the same browser profile at the same time.

The service runs Walmart catalog and recent-order sync jobs on startup and then at the configured local intervals:

```yaml
walmart:
  catalogSyncMinutes: 60
  orderSyncMinutes: 60
```

Manual verification policy:

- Login, CAPTCHA, 2FA, robot checks, press-and-hold challenges, or security checks stop automation.
- The dashboard shows `manual action`.
- Use Open Walmart, finish the action yourself, then tap I Finished Verification to let scheduled sync resume.
- For item-specific cart actions, tap I Added It if you handled the cart manually or Retry after verification is cleared.

## Commands

```sh
npm run build
npm test
npm run doctor
npm run url
npm run launchd:install
npm run reminders:build
npm run walmart:login
npm run walmart:sync
npm run walmart:orders
npm start
```

`npm run doctor` checks Node, config, SQLite, Reminders helper status, Walmart profile directory, dashboard reachability, and LAN URL detection.

## LaunchAgent

Build once, then install the LaunchAgent:

```sh
npm run build
npm run launchd:install
launchctl bootout gui/$UID ~/Library/LaunchAgents/com.local.walmart-reminders.plist 2>/dev/null || true
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.local.walmart-reminders.plist
launchctl kickstart -k gui/$UID/com.local.walmart-reminders
```

Logs go to:

```text
var/logs/launchd.out.log
var/logs/launchd.err.log
```

`npm run launchd:install` writes a plist with paths for the current checkout, so rerun it after moving or recloning the repo.

## Dashboard

The dashboard has compact iPhone-first sections:

- Needs Review
- Auto Matched / Adding
- In Cart
- Unmatched
- Recent Activity

It stores the dashboard PIN locally in the iPhone browser using `localStorage`. Mutating and read API endpoints require the `x-dashboard-pin` header when a PIN is configured.

## Troubleshooting

### iPhone Cannot Reach App

Run:

```sh
npm run url
```

Use the `iPhone LAN` URL. Confirm the Mac and iPhone are on the same Wi-Fi and the server is running with host `0.0.0.0`.

### Reminders Permission Denied

Run `npm run doctor`. If macOS asks for Reminders access, allow it. If no prompt appears, check System Settings, Privacy & Security, Reminders, and grant access to Terminal or the service host.

### Walmart Needs Manual Login

Run:

```sh
npm run walmart:login
```

Complete login or verification in the opened browser. Do not try to automate around Walmart challenges.

### CAPTCHA, 2FA, Robot, Or Press-And-Hold

Automation stops and marks the Walmart session `manual action`. Use the dashboard's Open Walmart action, complete the step yourself, then tap I Finished Verification to clear the local pause flag. If an item was stopped mid-cart action, tap I Added It after handling it yourself or Retry after verification is cleared.

### Service Worker Not Available Over HTTP LAN

This is expected. HTTP LAN mode is for easy local access and Home Screen bookmarking. Configure local HTTPS to enable service-worker caching.

## API

Implemented endpoints:

- `GET /api/health`
- `GET /api/status`
- `GET /api/items`
- `GET /api/history`
- `GET /api/events`
- `POST /api/sync/reminders`
- `POST /api/sync/walmart-catalog`
- `POST /api/sync/orders`
- `POST /api/items/:id/approve`
- `POST /api/items/:id/reject`
- `POST /api/items/:id/delete`
- `POST /api/items/:id/retry`
- `POST /api/items/:id/mark-added`
- `POST /api/items/:id/mark-ordered`
- `POST /api/items/:id/search`
- `POST /api/walmart/open-session`
- `POST /api/walmart/resume-session`
