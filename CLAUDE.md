# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Home Organizer web application for managing household tasks and family events. It consists of:

1. **index.html** - A single-page web application that displays:
   - Weekly calendar view with events from multiple Google Calendars
   - Task list from Google Sheets with ability to mark tasks complete
   - Google OAuth authentication

2. **google-apps-script.js** - Backend automation script that:
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
- Pure vanilla JavaScript with ES6 modules
- External dependencies via CDN:
  - jwt-decode v3.1.2
  - Google Sign-In (GSI) client
  - Google APIs client library
- Custom gothic.js authentication wrapper (inlined)
- Polling intervals:
  - Google Sheets: 5 minutes
  - Google Calendar: 15 minutes

### Authentication Flow
1. Google OAuth2 with One-Tap sign-in
2. Collapsible sign-in tab (bottom-right)
3. Auto-sign-in for recognized users
4. Scopes: Google Sheets (read/write), Calendar (read-only)

### Calendar Integration
Three calendars with different themes:
1. **11 Appleton Chores** (green, omits past events)
2. **Kids Events** (orange)
3. **11 Appleton Family** (blue)

### Task Management
- Tasks stored in Google Sheet column format
- Click checkbox to mark complete (applies strikethrough)
- Completed tasks sorted to bottom of columns
- Google Apps Script archives completed tasks nightly
- **Alternating Tasks**: Tasks starting with "next" (e.g., "next trash", "next recycling") alternate between Cyrus and Samira columns when completed

### Google Apps Script Automation
- **importTasksFromCalendar()**: Parses "NAME: TASK" format events
- **archiveStrikethroughTasks()**: Moves completed to "Completed" sheet
  - Special handling for "next" tasks: When completed in Cyrus/Samira column, creates new task in alternate column
- **condenseTasksSheet()**: Removes empty rows
- Deduplication via stored event IDs (2-day retention)

## Key Configuration

**Google OAuth Client ID**: `138340694200-7b7bcj1ndlm3coovfs7hlf6alu8v0bou.apps.googleusercontent.com`

**Google Sheet ID**: `1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg`

**Calendar IDs**:
- Chores: `2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com`
- Kids: `km9ikgpkljdeiccu25mlng56d0@group.calendar.google.com`
- Family: `9a3dc07b1e64453f57c0aa64e2996fcbdce315a1ead4edd5a2f9579ccf4dce87@group.calendar.google.com`

## Code Patterns

### Event Rendering
- Calendar events rendered in 7-day table view at index.html:553-620
- Tasks rendered with checkbox UI at index.html:785-847
- Strikethrough applied via Sheets API batchUpdate at index.html:757-784

### Error Handling
- Auto-reload on API errors (index.html:549, 672)
- Script property initialization fallbacks (google-apps-script.js:54-68)

### Task Import Format
Calendar events must follow "NAME: TASK" format where:
- NAME = person's name (matches sheet column header)
- Multiple names supported via "/" separator (e.g., "Alice/Bob: Clean garage")