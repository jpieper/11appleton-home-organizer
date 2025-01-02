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
 ***********************************************************/
function archiveStrikethroughTasks() {
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';
  const COMPLETED_SHEET_NAME = 'Completed';

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);
  const completedSheet = ss.getSheetByName(COMPLETED_SHEET_NAME);

  const lastRow = tasksSheet.getLastRow();
  const lastCol = tasksSheet.getLastColumn();
  if (lastRow < 2) return; // no tasks

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
