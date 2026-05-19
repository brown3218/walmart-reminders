# Walmart Reminders

Mac mini resident app that watches an Apple Reminders grocery list, matches items against Walmart previously ordered items, and exposes a phone-friendly local dashboard for approval.

## Current MVP Slice

- TypeScript/Express dashboard service.
- SQLite schema and idempotent reminder ingestion.
- Grocery text parser and prior-purchase matcher.
- Playwright persistent Walmart profile helpers.
- Swift EventKit spike that prints incomplete reminders as JSON lines.
- LaunchAgent template.

## Setup

```sh
cd /Users/davidbrown/Walmart
npm install
cp config.example.yaml config.yaml
npm run build
npm start
```

Open the dashboard from the Mac:

```text
http://localhost:3789
```

From your phone on the same LAN, use:

```text
http://mac-mini.local:3789
```

The port is required. Opening only `http://mac-mini.local` will not reach the dashboard.

Then add it to the iPhone Home Screen from Safari.

## Swift Reminders Spike

```sh
cd apps/reminder-watcher-swift
swift run reminder-watcher Walmart "Walmart shopping list"
```

The first run should prompt for Reminders access. It prints one JSON line per incomplete reminder.

## Reminder Sync

The Node service runs `scripts/read-reminders.applescript` on startup and every `reminders.pollSeconds`.
Add an incomplete item to the configured Reminders list, then refresh the dashboard. It should appear under **Needs Approval** after one poll.

## Walmart Session Spike

The Playwright helpers use a persistent profile under `var/walmart-profile`. The first automation run should open a browser where you manually log in to Walmart. The app reuses that session and never stores your Walmart password.

Automation stops if Walmart asks for login, CAPTCHA, 2FA, or another manual check.
If Walmart shows a robot/press-and-hold challenge, use the dashboard's **Open Walmart** button to complete the add in your normal browser/app, then tap **I Added It** so the local process history stays accurate. The app does not bypass Walmart challenges.

To set up or repair the session manually:

```sh
npm run walmart:login
```

Log in to Walmart in the opened browser window, complete any verification, then close the window.

## LaunchAgent

After `npm run build`, copy or symlink:

```sh
cp launchd/com.local.walmart-reminders.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.local.walmart-reminders.plist
```

Update the `ProgramArguments` path in the plist if `npm` is not at `/usr/local/bin/npm`.
