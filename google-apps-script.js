/**
 * 1) IMPORT TASKS FROM CALENDAR
 *    - Looks for events with titles in the format "NAME: TASK".
 *    - NAME must match a column header in the "Tasks" sheet.
 *    - TASK is inserted into the first empty cell of that column.
 */
function importTasksFromCalendar() {
  // -- 1. Define your Calendar and Spreadsheet info
  const CALENDAR_ID = '2e45b1ad345b0c3420065de28fce836557d1eda41b2170b797e620ad7e228973@group.calendar.google.com';
  const SPREADSHEET_ID = '1GjfSyjb4nGcFVNWez9Q55-Q9P2pnD30TenKeD0JQVeg';
  const TASKS_SHEET_NAME = 'Tasks';

  // -- 2. Fetch recent events from the calendar
  //    Adjust the time window as needed (e.g. last 15 minutes).
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
      // Parse out NAME and TASK
      const name = parts[0].trim();  // e.g. "Alice"
      const taskText = parts[1].trim();  // e.g. "Buy groceries"

      // Find which column belongs to this NAME
      // headerValues.indexOf(name) will be -1 if not found
      const colIndex = headerValues.indexOf(name) + 1;
      if (colIndex > 0) {
        // We found a matching column header

        // -- 6. Find the first empty row in that column
        const lastRow = tasksSheet.getLastRow();
        let placed = false;

        // Search row by row for an empty cell
        for (let row = 2; row <= lastRow; row++) {
          const cell = tasksSheet.getRange(row, colIndex);
          if (!cell.getValue()) {
            // If it's empty, remove any strikethrough just in case
            cell.setTextStyle(SpreadsheetApp.newTextStyle().build());
            // Put the task text in that cell
            cell.setValue(taskText);
            placed = true;
            break;
          }
        }

        // -- 7. If no empty cell was found in existing rows,
        //       place the task in the next new row
        if (!placed) {
          const newRow = lastRow + 1;
          const cell = tasksSheet.getRange(newRow, colIndex);
          cell.setTextStyle(SpreadsheetApp.newTextStyle().build());
          cell.setValue(taskText);
        }
      }
    }
  });
}

/**
 * 2) ARCHIVE COMPLETED (STRIKETHROUGH) TASKS
 *    - Runs at midnight via a time-based trigger.
 *    - For each cell in the "Tasks" sheet (excluding headers):
 *      a) If the cell is non-empty and is strikethrough, move to "Completed".
 *      b) Then remove the content from the "Tasks" cell.
 *      c) If a cell is empty but strikethrough is applied, remove the strikethrough.
 */
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

  // -- 4. Loop through each cell in the data range (starting at row 2)
  for (let row = 2; row <= lastRow; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const cell = tasksSheet.getRange(row, col);
      const cellValue = cell.getValue();

      // Get the TextStyle for strikethrough detection
      const cellStyle = cell.getTextStyle();
      const isStrikethrough = cellStyle && cellStyle.isStrikethrough();

      if (isStrikethrough) {
        // CASE A: Cell is NON-EMPTY and has strikethrough => archive it
        if (cellValue) {
          // Grab column header (the "NAME")
          const headerName = tasksSheet.getRange(1, col).getValue();

          // Timestamp for when it's archived
          const timestamp = new Date();

          // Append a new row in the "Completed" sheet: [Date, Name, Task]
          completedSheet.appendRow([timestamp, headerName, cellValue]);

          // Remove the old content
          cell.clearContent();
          // Clear out the strikethrough style
          cell.setTextStyle(SpreadsheetApp.newTextStyle().build());
        }
        // CASE B: Cell is EMPTY but has strikethrough => just remove strikethrough
        else {
          cell.setTextStyle(SpreadsheetApp.newTextStyle().build());
        }
      }
    }
  }
}
