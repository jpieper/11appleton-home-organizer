# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Home Organizer web application for managing household tasks and family events. It consists of:

1. **index.html** - A single-page kiosk web application that displays:
   - Weekly calendar view with events from multiple Google Calendars
   - Task list with the ability to mark tasks complete
   - All data comes from the Apps Script Web App (below). There is **no
     Google sign-in on the tablet** — the page just `fetch()`es JSON.
   - Auto-fit "shrink-to-fit" layout: content is scaled so the calendar
     and task halves fill the screen without scrolling.

2. **google-apps-script.js** - Backend that:
   - Serves the dashboard data + handles task completion via a Web App
     (`doGet`), running as the owner with durable authorization
   - Imports tasks from calendar events to Google Sheets
   - Archives completed tasks nightly
   - Manages task deduplication

## Development Commands

This is a vanilla HTML/JavaScript project with no build system:

- **Run locally**: Open `index.html` in a web browser
- **Deploy backend**: Deploy `google-apps-script.js` through Google Apps Script editor
- **No build/test commands** - Direct browser execution only

## Architecture

### Frontend (index.html)
- Pure vanilla JavaScript, no external dependencies, no build system
- Reads everything from the Apps Script Web App (`WEB_APP_URL`) with
  `fetch()`; refreshes everything every `REFRESH_MS` (5 minutes)
- `fitRegion()` binary-searches the largest font size at which each
  half's content fits its box, so nothing overflows the tablet screen
- On fetch error it shows a quiet "retrying" banner (no page reload)

### Data Access (no tablet login)
- The tablet does **not** authenticate. The Apps Script Web App is
  deployed "Execute as: Me / Anyone (anonymous)", so it carries the
  owner's durable authorization and the tablet only needs the `/exec` URL.
- Shared secret (`API_TOKEN` Script Property): the token is **not** stored
  in the public page. Each tablet keeps it in `localStorage`, set once by
  opening `<page-url>#token=YOUR_SECRET` — `resolveToken()` saves it and
  scrubs it from the URL. So page source contains no secret.
- The write path is deliberately tiny: `completeDashboardTask()` can only
  set strikethrough on an existing, non-empty, not-already-done Tasks cell
  (never the header, out-of-range cells, content, or any other sheet), and
  it is reversible. The endpoint is not a generic "Sheets-as-me" proxy.
- OAuth scopes are pinned minimal in `appsscript.json` (`spreadsheets` +
  `calendar.readonly`).
- This replaced the previous client-side Google OAuth (GSI One-Tap +
  gapi token client), whose ~1h implicit tokens and unverified-app
  consent screen caused frequent re-logins.

### Calendar Integration
Three calendars with different themes (read server-side in
`getDashboardEvents()`; colors applied client-side from `COLORS`):
1. **11 Appleton Chores** (green, omits past events)
2. **Kids Events** (orange)
3. **11 Appleton Family** (blue)

### Task Management
- Tasks stored in Google Sheet column format
- Click checkbox to mark complete: the tablet calls the Web App
  (`?action=complete&row=&col=`) which applies the strikethrough
- Completed tasks sorted to bottom of columns (client-side display only)
- Google Apps Script archives completed tasks nightly
- **Alternating Tasks**: Tasks starting with "next" (e.g., "next trash", "next recycling") alternate between paired columns when completed
  - Column pairs defined in `ALTERNATING_PAIRS` array in google-apps-script.js:184
  - Currently configured: Cyrus ↔ Samira
  - Easy to add more pairs by editing the array

### Google Apps Script Automation
- **doGet(e)**: Web App endpoint. `action=data` (default) returns
  `{ days, events, tasks }`; `action=complete&row=&col=` strikes a task
  cell. GET-only so the tablet's cross-origin fetch avoids a CORS preflight.
- **importTasksFromCalendar()**: Parses "NAME: TASK" format events
- **archiveStrikethroughTasks()**: Moves completed to "Completed" sheet
  - Special handling for "next" tasks: When completed in one column, creates new task in paired column
  - Column pairs configured via `ALTERNATING_PAIRS` data structure
- **condenseTasksSheet()**: Removes empty rows
- Deduplication via stored event IDs (2-day retention)

**Deploy the Web App:** Apply `appsscript.json` first (set its `timeZone`
to your zone — it controls day bucketing). Deploy > New deployment > Web
app, Execute as "Me", Who has access "Anyone". Copy the `/exec` URL into
`WEB_APP_URL` in index.html. Re-deploy (new version) after editing the
script. Set Script Property `API_TOKEN`, then authorize each tablet once
by visiting `<page-url>#token=YOUR_SECRET`.

## Key Configuration

**Web App URL** (`WEB_APP_URL` in index.html): the Apps Script `/exec`
deployment URL. Must be set for the page to load data.

**API token** (Script Property `API_TOKEN`): shared secret. **Not** stored
in index.html — each tablet stores it in `localStorage` via a one-time
`<page-url>#token=YOUR_SECRET` visit. Leave the property empty to disable.

**appsscript.json**: pins minimal OAuth scopes and the Web App access
config. Set its `timeZone` to your actual zone.

> The previous client-side OAuth Client ID is no longer used by the
> tablet. The Apps Script project still needs Calendar/Sheets access, but
> that authorization is granted once by the owner at deploy time.

**Google Sheet ID**: `1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg`

**Calendar IDs**:
- Chores: `2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com`
- Kids: `km9ikgpkljdeiccu25mlng56d0@group.calendar.google.com`
- Family: `9a3dc07b1e64453f57c0aa64e2996fcbdce315a1ead4edd5a2f9579ccf4dce87@group.calendar.google.com`

## Code Patterns

### Event Rendering
- Calendar events rendered in 7-day table view: `renderCalendar()`
- Tasks rendered with checkbox UI: `renderTasks()`
- Completion sent to the backend: `completeTask()` -> `doGet(action=complete)`
- Content scaled to fit the screen: `fitRegion()` / `fitAll()`

### Error Handling
- Fetch failures show a "retrying" banner; next poll recovers (no reload)
- Script property initialization fallbacks (google-apps-script.js)

### Task Import Format
Calendar events must follow "NAME: TASK" format where:
- NAME = person's name (matches sheet column header)
- Multiple names supported via "/" separator (e.g., "Alice/Bob: Clean garage")