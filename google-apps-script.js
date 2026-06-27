/***********************************************************
 *  0) INITIALIZERS / UTILITY
 ***********************************************************/

/**
 * (Optional) Run once to initialize script properties if you want.
 * If they're missing, we initialize them automatically in importTasksFromCalendar().
 */
function initScriptProperties() {
  const props = PropertiesService.getScriptProperties();

  // Set 'lastImportTime' to now - 15 min if missing
  if (!props.getProperty('lastImportTime')) {
    const initTime = new Date(Date.now() - 15 * 60 * 1000);
    props.setProperty('lastImportTime', initTime.toISOString());
    Logger.log('Initialized lastImportTime to ' + initTime);
  }

  // Set 'importedEvents' to an empty array if missing
  if (!props.getProperty('importedEvents')) {
    props.setProperty('importedEvents', JSON.stringify([]));
    Logger.log('Initialized importedEvents to an empty array.');
  }
}

/**
 * Removes any event IDs from the array that are older than `daysOld` days.
 * Returns a filtered array. This helps keep our property storage small.
 */
function filterOutOldEventIds(importedEvents, daysOld) {
  const now = new Date();
  const cutoffMs = daysOld * 24 * 60 * 60 * 1000; // #days in ms

  return importedEvents.filter(entry => {
    const importedAtDate = new Date(entry.importedAt);
    const ageMs = now.getTime() - importedAtDate.getTime();
    return ageMs < cutoffMs; // keep if younger than cutoff
  });
}

/***********************************************************
 *  1) IMPORT TASKS FROM CALENDAR (DEDUP + AUTO-REMOVAL)
 ***********************************************************/
function importTasksFromCalendar() {
  // -- 1. Define your Calendar and Spreadsheet info
  const CALENDAR_ID = '2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com';
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';

  // -- 2. Load script properties
  const props = PropertiesService.getScriptProperties();

  // If missing, init them now
  let lastImportTimeStr = props.getProperty('lastImportTime');
  if (!lastImportTimeStr) {
    const initTime = new Date(Date.now() - 15 * 60 * 1000);
    lastImportTimeStr = initTime.toISOString();
    props.setProperty('lastImportTime', lastImportTimeStr);
    Logger.log('No lastImportTime found. Initialized to ' + lastImportTimeStr);
  }
  const lastImportTime = new Date(lastImportTimeStr);

  let importedEventsStr = props.getProperty('importedEvents');
  if (!importedEventsStr) {
    importedEventsStr = JSON.stringify([]);
    props.setProperty('importedEvents', importedEventsStr);
    Logger.log('No importedEvents found. Initialized to empty array.');
  }
  let importedEvents = JSON.parse(importedEventsStr); // Array of { id, importedAt }

  // -- 3. First, remove any event IDs older than 2 days
  importedEvents = filterOutOldEventIds(importedEvents, 2);
  Logger.log('After removing old events, we have ' + importedEvents.length + ' items stored.');

  // -- 4. Fetch new events from lastImportTime to now
  const now = new Date();
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = calendar.getEvents(lastImportTime, now);
  Logger.log('Found ' + events.length + ' events between ' + lastImportTime + ' and ' + now);

  // -- 5. Open spreadsheet and get the 'Tasks' sheet
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);

  // -- 6. Get column headers (the first row in "Tasks")
  const headerValues = tasksSheet
    .getRange(1, 1, 1, tasksSheet.getLastColumn())
    .getValues()[0];

  // -- 7. Process each event if not previously imported
  events.forEach(event => {
    const eventId = event.getId();  // Unique ID from Google Calendar
    const alreadyImported = importedEvents.some(e => e.id === eventId);
    if (alreadyImported) {
      Logger.log('Skipping (already imported) eventId: ' + eventId);
      return;
    }

    // Parse the event title "NAME: TASK"
    const title = event.getTitle();
    const parts = title.split(':');
    if (parts.length === 2) {
      const namesPart = parts[0].trim();  // e.g. "Alice" or "Bob/Alice"
      const taskText  = parts[1].trim();  // e.g. "Buy groceries"

      // If multiple names separated by '/', handle each
      const nameList = namesPart.split('/').map(n => n.trim()).filter(Boolean);

      // Place the task in each relevant column
      nameList.forEach(name => {
        const colIndex = headerValues.indexOf(name) + 1;
        if (colIndex > 0) {
          placeTaskInColumn(tasksSheet, colIndex, taskText);
        }
      });
    } else {
      Logger.log('Skipping event with malformed title: ' + title);
    }

    // -- Mark as imported
    importedEvents.push({
      id: eventId,
      importedAt: new Date().toISOString()
    });
    Logger.log('Imported event: ' + eventId + ' => "' + event.getTitle() + '"');
  });

  // -- 8. Update lastImportTime
  props.setProperty('lastImportTime', now.toISOString());
  // -- 9. Write the updated array back
  props.setProperty('importedEvents', JSON.stringify(importedEvents));

  Logger.log('Updated lastImportTime, now have ' + importedEvents.length + ' stored event IDs.');
}


/***********************************************************
 *  placeTaskInColumn
 *  - Finds the first empty row in the given column.
 *  - If none found, tries to add a new row.
 *  - Clears leftover formatting so there's no strikethrough.
 ***********************************************************/
function placeTaskInColumn(tasksSheet, colIndex, taskText) {
  const lastRow = tasksSheet.getLastRow();

  // 1. Search for the first empty row from row 2 onward
  for (let row = 2; row <= lastRow; row++) {
    const cell = tasksSheet.getRange(row, colIndex);
    if (!cell.getValue()) {
      cell.clearFormat();
      cell.setValue(taskText);
      return;
    }
  }

  // 2. If no empty row found, insert a new one at the bottom
  try {
    tasksSheet.insertRowsAfter(lastRow, 1);
    const newRow = lastRow + 1;
    const newCell = tasksSheet.getRange(newRow, colIndex);
    newCell.clearFormat();
    newCell.setValue(taskText);
  } catch (e) {
    Logger.log('Failed to insert a new row for task "' + taskText + '": ' + e);
  }
}


/***********************************************************
 *  2) ARCHIVE COMPLETED (STRIKETHROUGH) TASKS
 *     - Runs nightly (via trigger).
 *     - Special handling for "next" tasks: When a task starting
 *       with "next" (e.g., "next trash", "next recycling") is
 *       completed in one column, it creates a new identical task
 *       in the paired alternate column based on ALTERNATING_PAIRS.
 ***********************************************************/
function archiveStrikethroughTasks() {
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';
  const COMPLETED_SHEET_NAME = 'Completed';
  
  // Define column pairs for alternating tasks
  // Each pair is [columnA, columnB] - tasks alternate between these columns
  const ALTERNATING_PAIRS = [
    ['Cyrus', 'Samira'],
    // Add more pairs here as needed, e.g.:
    // ['Alice', 'Bob'],
    // ['Team A', 'Team B']
  ];

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);
  const completedSheet = ss.getSheetByName(COMPLETED_SHEET_NAME);

  const lastRow = tasksSheet.getLastRow();
  const lastCol = tasksSheet.getLastColumn();
  if (lastRow < 2) return; // no tasks

  // Get all column headers upfront
  const headers = tasksSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  
  // Build a map of column names to their alternating partner and column index
  const alternatingMap = {};
  ALTERNATING_PAIRS.forEach(pair => {
    const [colA, colB] = pair;
    const colAIndex = headers.indexOf(colA) + 1;
    const colBIndex = headers.indexOf(colB) + 1;
    
    if (colAIndex > 0 && colBIndex > 0) {
      alternatingMap[colA] = { partner: colB, partnerIndex: colBIndex };
      alternatingMap[colB] = { partner: colA, partnerIndex: colAIndex };
    }
  });

  // Loop through each cell in the data range
  for (let row = 2; row <= lastRow; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const cell = tasksSheet.getRange(row, col);
      const cellValue = cell.getValue();
      const cellStyle = cell.getTextStyle();
      const isStrikethrough = cellStyle && cellStyle.isStrikethrough();

      if (isStrikethrough) {
        if (cellValue) {
          // Archive
          const headerName = tasksSheet.getRange(1, col).getValue();
          completedSheet.appendRow([new Date(), headerName, cellValue]);
          
          // Check if this is a "next" task that should alternate
          const taskText = String(cellValue).toLowerCase().trim();
          if (taskText.startsWith('next ')) {
            // Check if this column has an alternating partner
            const currentColumnName = headerName;
            if (alternatingMap[currentColumnName]) {
              const { partner, partnerIndex } = alternatingMap[currentColumnName];
              placeTaskInColumn(tasksSheet, partnerIndex, cellValue);
              Logger.log(`Created alternating task in ${partner} column: ${cellValue}`);
            }
          }
          
          // Remove from "Tasks"
          cell.clearContent();
          cell.clearFormat();
        } else {
          // Just remove the strikethrough from an empty cell
          cell.clearFormat();
        }
      }
    }
  }

  // After archiving, condense
  condenseTasksSheet(tasksSheet);
}


/***********************************************************
 *  3) CONDENSE TASKS SHEET
 *     - Moves tasks up so no blank rows exist in each column.
 ***********************************************************/
function condenseTasksSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;

  const numDataRows = lastRow - 1; // everything below row 1

  for (let col = 1; col <= lastCol; col++) {
    // Grab column values from row 2 down
    const colRange = sheet.getRange(2, col, numDataRows);
    const colValues = colRange.getValues().map(r => r[0]);

    // Filter out empties
    const nonEmptyValues = colValues.filter(value => value !== '');

    // Clear existing format, then fill top-down
    colRange.clearFormat();

    if (nonEmptyValues.length > 0) {
      // Write them back at the top
      sheet
        .getRange(2, col, nonEmptyValues.length, 1)
        .setValues(nonEmptyValues.map(v => [v]));
    }

    // Clear out the remainder
    const remainder = numDataRows - nonEmptyValues.length;
    if (remainder > 0) {
      sheet
        .getRange(2 + nonEmptyValues.length, col, remainder, 1)
        .clearContent()
        .clearFormat();
    }
  }
}


/***********************************************************
 *  4) WEB APP API  (powers the tablet/kiosk dashboard)
 *
 *  This lets index.html read the calendar + tasks and mark
 *  tasks complete WITHOUT any Google sign-in on the tablet.
 *  The script runs as you (the owner), authorized once.
 *
 *  Deploy:  Deploy > New deployment > type "Web app"
 *    - Execute as:      Me
 *    - Who has access:  Anyone
 *  Copy the resulting /exec URL into index.html (WEB_APP_URL).
 *
 *  Optional shared secret: set a Script Property named
 *  'API_TOKEN' (Project Settings > Script Properties) to a
 *  random string, and put the same value in index.html
 *  (API_TOKEN). If unset, the endpoint is open to anyone with
 *  the (unguessable) /exec URL.
 ***********************************************************/

// Calendars shown on the dashboard (mirrors CALENDARS in index.html).
const DASHBOARD_CALENDARS = [
  { id: '2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com', color: 'chores', omitPastEvents: true },
  { id: 'km9ikgpkljdeiccu25mlng56d0@group.calendar.google.com', color: 'kids' },
  { id: '9a3dc07b1e64453f57c0aa64e2996fcbdce315a1ead4edd5a2f9579ccf4dce87@group.calendar.google.com', color: 'family' },
];

const DASHBOARD_SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
const DASHBOARD_TASKS_SHEET = 'Tasks';
const DASHBOARD_DAYS = 7;

/**
 * Single GET endpoint. `?action=data` (default) returns the
 * calendar + tasks payload; `?action=complete&row=&col=` strikes
 * a task cell complete. We use GET for everything so the tablet's
 * cross-origin fetch() never triggers a CORS preflight.
 */
function doGet(e) {
  try {
    if (!checkApiToken(e)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }
    const action = (e && e.parameter && e.parameter.action) || 'data';
    if (action === 'complete') {
      const row = parseInt(e.parameter.row, 10);
      const col = parseInt(e.parameter.col, 10);
      completeDashboardTask(row, col);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: true, data: getDashboardData() });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function checkApiToken(e) {
  const required = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!required) return true; // no token configured -> open access
  const provided = e && e.parameter ? e.parameter.token : null;
  return provided === required;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDashboardData() {
  return {
    days: getDashboardDays(),
    events: getDashboardEvents(),
    tasks: getDashboardTasks(),
  };
}

// The 7 day-columns, computed server-side so the tablet's clock /
// timezone can't shift events into the wrong day.
function getDashboardDays() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const days = [];
  for (let i = 0; i < DASHBOARD_DAYS; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    days.push({
      key: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
      label: Utilities.formatDate(d, tz, 'EEE MMM d'),
    });
  }
  return days;
}

function getDashboardEvents() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const end = new Date(now.getTime() + (DASHBOARD_DAYS - 1) * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 999);

  const out = [];
  DASHBOARD_CALENDARS.forEach(cal => {
    const calendar = CalendarApp.getCalendarById(cal.id);
    if (!calendar) return; // no access / bad id -> skip rather than fail
    let events = calendar.getEvents(now, end);
    if (cal.omitPastEvents) {
      events = events.filter(ev => ev.getStartTime().getTime() >= now.getTime());
    }
    events.forEach(ev => {
      const start = ev.getStartTime();
      out.push({
        summary: ev.getTitle(),
        color: cal.color,
        dateKey: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
        time: ev.isAllDayEvent() ? 'All Day' : formatDashboardTime(start, tz),
        sortMs: start.getTime(),
      });
    });
  });
  return out;
}

function formatDashboardTime(date, tz) {
  // "9:30 AM" -> "9:30am"; "9:00 AM" -> "9am"
  return Utilities.formatDate(date, tz, 'h:mm a').toLowerCase().replace(' ', '').replace(':00', '');
}

function getDashboardTasks() {
  const ss = SpreadsheetApp.openById(DASHBOARD_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DASHBOARD_TASKS_SHEET);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], columns: [] };

  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  const styles = range.getTextStyles();

  const headers = values[0].map(h => (h === null || h === undefined) ? '' : String(h));

  const columns = [];
  for (let c = 0; c < lastCol; c++) {
    const colItems = [];
    for (let r = 1; r < lastRow; r++) { // r is the 0-based grid row (1 = first data row)
      const raw = values[r][c];
      const style = styles[r][c];
      colItems.push({
        text: (raw === null || raw === undefined) ? '' : String(raw),
        isStricken: !!(style && style.isStrikethrough()),
        row: r,
        col: c,
      });
    }
    columns.push(colItems);
  }
  return { headers, columns };
}

// row/col are the 0-based grid indices returned by getDashboardTasks().
//
// SECURITY: this is the ONLY write the Web App can perform, and it is
// deliberately tiny. It can only set strikethrough on an existing,
// non-empty, not-already-done cell in the Tasks sheet. It can never:
//   - touch the header row (row 0) or any out-of-range cell,
//   - reach any other sheet or spreadsheet,
//   - write, replace, or delete any content.
// The applied strikethrough is exactly what the nightly
// archiveStrikethroughTasks() (and the "next" alternating logic) expects.
// Worst case for a leaked credential: marking existing chores "done",
// which is reversible via Sheets version history and the Completed archive.
function completeDashboardTask(row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col)) throw new Error('invalid cell');
  if (row < 1 || col < 0) throw new Error('cell out of range'); // row 0 is the header

  const ss = SpreadsheetApp.openById(DASHBOARD_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DASHBOARD_TASKS_SHEET);
  if (row + 1 > sheet.getLastRow() || col + 1 > sheet.getLastColumn()) {
    throw new Error('cell out of range');
  }

  const cell = sheet.getRange(row + 1, col + 1);
  const value = cell.getValue();
  if (value === '' || value === null) throw new Error('cell is empty'); // only real tasks
  if (cell.getTextStyle().isStrikethrough()) return; // already done -> idempotent no-op

  const style = cell.getTextStyle().copy().setStrikethrough(true).build();
  cell.setTextStyle(style);
}
