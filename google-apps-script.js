/****************************************************
 *  Setup / Utility
 ****************************************************/

/**
 * Initializes script properties if they do not exist.
 * Optional function to run manually once or as needed.
 */
function initLastImportTime() {
  const props = PropertiesService.getScriptProperties();
  // If "lastImportTime" not set, initialize to "now - 15 minutes"
  if (!props.getProperty('lastImportTime')) {
    const initialTime = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago
    props.setProperty('lastImportTime', initialTime.toISOString());
  }
  Logger.log('Initialized lastImportTime: ' + props.getProperty('lastImportTime'));
}

/****************************************************
 *  1) Import Tasks From Calendar (No Race Condition)
 ****************************************************/
function importTasksFromCalendar() {
  // -- 1. Define your Calendar and Spreadsheet info
  const CALENDAR_ID = '2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com';
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';

  // -- 2. Use Script Properties to avoid the race condition
  const props = PropertiesService.getScriptProperties();
  let lastImportTimeString = props.getProperty('lastImportTime');

  // If it doesn't exist yet, default to "now - 15 minutes"
  if (!lastImportTimeString) {
    // You could also call initLastImportTime() here automatically
    const initialTime = new Date(Date.now() - 15 * 60 * 1000);
    lastImportTimeString = initialTime.toISOString();
    props.setProperty('lastImportTime', lastImportTimeString);
    Logger.log('No lastImportTime found. Setting it to: ' + lastImportTimeString);
  }

  const lastImportTime = new Date(lastImportTimeString);
  const now = new Date();

  // (Optional) Add a small buffer if you want to ensure boundary events are included
  // For example, fetch from lastImportTime - 1 minute to now + 1 minute
  // then filter or deduplicate if needed. For simplicity, we do a direct range:
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = calendar.getEvents(lastImportTime, now);

  // -- 3. Open the Spreadsheet and get the 'Tasks' sheet
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);

  // -- 4. Get column headers (the first row in "Tasks")
  const headerValues = tasksSheet
    .getRange(1, 1, 1, tasksSheet.getLastColumn())
    .getValues()[0];

  // -- 5. For each event, parse "NAME: TASK" from the title
  events.forEach(event => {
    const title = event.getTitle();
    const parts = title.split(':');
    if (parts.length === 2) {
      const namesPart = parts[0].trim();   // e.g. "Alice" or "Bob/Alice"
      const taskText  = parts[1].trim();   // e.g. "Buy groceries"

      // If multiple names are separated by '/', handle each name
      const nameList = namesPart.split('/').map(n => n.trim()).filter(Boolean);

      // For each name in nameList, find the appropriate column
      nameList.forEach(name => {
        const colIndex = headerValues.indexOf(name) + 1;
        if (colIndex > 0) {
          // Place the task text in the first empty row or a new row
          placeTaskInColumn(tasksSheet, colIndex, taskText);
        }
      });
    }
  });

  // -- 6. Update lastImportTime to "now" to avoid re-importing these events
  props.setProperty('lastImportTime', now.toISOString());
  Logger.log('Updated lastImportTime to: ' + now);
}


/**
 * Helper function to place 'taskText' into the first empty cell of 'colIndex'
 * in tasksSheet. If no empty cell is found, inserts a new row at the bottom.
 * If insertion fails, logs an error.
 * Also ensures that no leftover strike/bold formatting remains.
 */
function placeTaskInColumn(tasksSheet, colIndex, taskText) {
  const lastRow = tasksSheet.getLastRow();

  // 1. Search for the first empty row from row 2 onward
  for (let row = 2; row <= lastRow; row++) {
    const cell = tasksSheet.getRange(row, colIndex);
    if (!cell.getValue()) {
      // Clear leftover formatting in this cell
      cell.clearFormat();
      // Then put the task text in that cell
      cell.setValue(taskText);
      return; // done
    }
  }

  // 2. If we got here, no empty cell was found in existing rows
  //    Try to insert a new row at the bottom
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


/****************************************************
 *  2) ARCHIVE COMPLETED (STRIKETHROUGH) TASKS
 ****************************************************/
function archiveStrikethroughTasks() {
  // -- 1. Define your Spreadsheet info
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';
  const COMPLETED_SHEET_NAME = 'Completed';

  // -- 2. Open spreadsheet and sheets
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);
  const completedSheet = ss.getSheetByName(COMPLETED_SHEET_NAME);

  // -- 3. Find boundaries
  const lastRow = tasksSheet.getLastRow();
  const lastCol = tasksSheet.getLastColumn();
  if (lastRow < 2) {
    // If there's no data row at all, nothing to do
    return;
  }

  // -- 4. Loop through each cell in the data range (starting at row 2)
  for (let row = 2; row <= lastRow; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const cell = tasksSheet.getRange(row, col);
      const cellValue = cell.getValue();

      // Get the TextStyle for strikethrough detection
      const cellStyle = cell.getTextStyle();
      const isStrikethrough = cellStyle && cellStyle.isStrikethrough();

      if (isStrikethrough) {
        // CASE A: Cell is NON-EMPTY => archive it
        if (cellValue) {
          // Grab column header (the "NAME")
          const headerName = tasksSheet.getRange(1, col).getValue();

          // Timestamp for when it's archived
          const timestamp = new Date();

          // Append a new row in "Completed" sheet: [Timestamp, Name, Task]
          completedSheet.appendRow([timestamp, headerName, cellValue]);

          // Remove content & formatting
          cell.clearContent();
          cell.clearFormat();
        }
        // CASE B: Cell is EMPTY but has strikethrough => just remove strikethrough
        else {
          cell.clearFormat();
        }
      }
    }
  }

  // -- 5. After archiving, condense tasks so no blank cells remain in each column
  condenseTasksSheet(tasksSheet);
}


/****************************************************
 *  3) CONDENSE THE "Tasks" SHEET
 ****************************************************/
function condenseTasksSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;

  const numDataRows = lastRow - 1; // everything below header row

  for (let col = 1; col <= lastCol; col++) {
    // Grab column values from row 2 downward
    const colRange = sheet.getRange(2, col, numDataRows);
    const colValues = colRange.getValues().map(r => r[0]);

    // Filter out empty cells
    const nonEmptyValues = colValues.filter(value => value !== '');

    // Overwrite from row 2 down with these tasks
    if (nonEmptyValues.length > 0) {
      // 1) Clear formatting in the whole range so no strikethrough persists
      colRange.clearFormat();

      // 2) Write non-empty tasks, top down
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
