/***************************************
 * 1) IMPORT TASKS FROM CALENDAR
 *    - Parses event titles in the format "NAME: TASK".
 *    - If NAME includes multiple names (e.g. "Alice/Bob"),
 *      it splits them by '/' and adds the same task for each name.
 *    - Finds the correct column in the "Tasks" sheet by matching NAME
 *      to the header row, then places the TASK in the first empty row.
 *    - If no empty row is found, it inserts a new row. If insertion fails,
 *      it logs an error.
 ***************************************/
function importTasksFromCalendar() {
  // -- 1. Define your Calendar and Spreadsheet info
  const CALENDAR_ID = '2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com';
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';

  // -- 2. Fetch recent events from the calendar
  //    Adjust the time window as needed (e.g., last 15 minutes).
  const now = new Date();
  const timeWindowInMinutes = 15;
  const startTime = new Date(now.getTime() - timeWindowInMinutes * 60 * 1000);

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = calendar.getEvents(startTime, now);

  // -- 3. Open the Spreadsheet and get the 'Tasks' sheet
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_SHEET_NAME);

  // -- 4. Get column headers (the first row in "Tasks")
  //       This returns an array, e.g. ['Alice','Bob','Charlie',...]
  const headerValues = tasksSheet
    .getRange(1, 1, 1, tasksSheet.getLastColumn())
    .getValues()[0];

  // -- 5. For each event, parse "NAME: TASK" from the title
  events.forEach(event => {
    const title = event.getTitle();
    const parts = title.split(':');
    if (parts.length === 2) {
      // Parse out the "NAME" part (possibly multiple) and the "TASK"
      const namesPart = parts[0].trim();   // e.g. "Alice" or "Bob/Alice"
      const taskText  = parts[1].trim();   // e.g. "Buy groceries"

      // Split names by '/' to handle multiple names
      const nameList = namesPart.split('/').map(n => n.trim()).filter(Boolean);

      // For each name in nameList, find the appropriate column
      nameList.forEach(name => {
        const colIndex = headerValues.indexOf(name) + 1;
        if (colIndex > 0) {
          // Place the task text in the first empty row or in a new row
          placeTaskInColumn(tasksSheet, colIndex, taskText);
        }
      });
    }
  });
}


/**
 * Helper function:
 * Tries to place 'taskText' into the first empty cell of 'colIndex' in tasksSheet.
 * If no empty cell is found, inserts a new row at the bottom. If insertion fails,
 * logs an error. IMPORTANT: Calls clearFormat() to ensure no leftover styling.
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
    // Clear leftover formatting in the new row
    newCell.clearFormat();
    // Place the task text
    newCell.setValue(taskText);
  } catch (e) {
    // If insertion fails, log an error
    Logger.log('Failed to insert a new row for task "' + taskText + '": ' + e);
  }
}


/***************************************
 * 2) ARCHIVE COMPLETED (STRIKETHROUGH) TASKS
 *    - Runs at midnight via a time-based trigger.
 *    - For each cell in "Tasks" (excluding headers):
 *      a) If the cell is non-empty AND strikethrough => move to "Completed".
 *      b) Then remove the content and strikethrough from the "Tasks" cell.
 *      c) If cell is empty but strikethrough => just remove strikethrough.
 *    - The "Completed" sheet will get: [Date, Name, Task]
 *    - After archiving, we call condenseTasksSheet() to move all remaining
 *      tasks up so no blank spaces remain in each column.
 ***************************************/
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

          // Append a new row in the "Completed" sheet: [Timestamp, Name, Task]
          completedSheet.appendRow([timestamp, headerName, cellValue]);

          // Remove the old content and strikethrough style
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


/***************************************
 * 3) CONDENSE THE "Tasks" SHEET
 *    - For each column (excluding header row),
 *      shift all non-empty cells up so there are no blank cells in between.
 *    - Again, we call clearFormat() on the overwritten area to ensure
 *      no leftover strikethrough or other styling persists.
 ***************************************/
function condenseTasksSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;

  // Start from row 2 (since row 1 is headers) to lastRow
  const numDataRows = lastRow - 1;

  for (let col = 1; col <= lastCol; col++) {
    // Grab column values from row 2 downward
    const colRange = sheet.getRange(2, col, numDataRows);
    const colValues = colRange.getValues().map(r => r[0]); // Flatten from 2D to 1D array

    // Filter out empty cells
    const nonEmptyValues = colValues.filter(value => value !== '');

    // Overwrite from row 2 down with these tasks
    if (nonEmptyValues.length > 0) {
      // 1) Clear formatting in the target range so no strikethrough persists
      sheet
        .getRange(2, col, numDataRows)
        .clearFormat();

      // 2) Write non-empty tasks, top down
      sheet
        .getRange(2, col, nonEmptyValues.length, 1)
        .setValues(nonEmptyValues.map(v => [v]));
    }

    // Clear the remainder of the column below the used cells
    const remainder = numDataRows - nonEmptyValues.length;
    if (remainder > 0) {
      sheet
        .getRange(2 + nonEmptyValues.length, col, remainder, 1)
        .clearContent()
        .clearFormat();
    }
  }
}
