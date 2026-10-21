# Google Apps Script — existing BNN Receiving Issues Google Sheets Sync

## Verified current state (21 Oct 2026)

- Existing editor: `https://script.google.com/u/0/home/projects/1orBKwfDOA8FntozbWpy-agunJM0ZC3O_nJFfEUlIRW4ZOzuQk_9i-5gA/edit`.
- Existing destination spreadsheet ID: `1jEFGBIUa1tStDaJSuI3HPvri6NdAICGTag2LCBGQAfM`.
- The Apps Script editor displayed **Save failed**. The selected `appsscript.json` textarea contains an **extra closing brace** following an otherwise complete JSON object. JSON.parse of the exact textarea fails at the final brace.
- A syntactically valid counterpart has been staged at `apps-script/appsscript.json` in this Draft PR and checked by GitHub CI. **It has not been applied to the live Apps Script project.**
- The Supabase `sheets-export` v2 function already exists and previously returned HTTP 200 for `kind=issues` and `kind=dispatches`. `REPORT_LOG` in the existing sheet contains one entry matching a real SENT Teams report.
- Those observations do **not** prove that an Apps Script time trigger is currently installed or that the project has saved its latest version.

## Remaining actions: repair in place, no duplication

1. In the **same existing** Apps Script project, select `appsscript.json`. Verify the live text still has an extra final `}`; remove only that extra brace. Validate and Save. Do not create another Apps Script project.
2. Check whether `รหัส.gs` uses `SpreadsheetApp.openById`. If so, the saved manifest must grant `https://www.googleapis.com/auth/spreadsheets`, not only `https://www.googleapis.com/auth/spreadsheets.currentonly`, and OAuth reauthorization may be necessary. Do not broaden scopes unnecessarily if the project is bound to the target spreadsheet and uses only `getActiveSpreadsheet`.
3. Inspect `Executions` for the last successful *sheet synchronization* run. Then read the matching rows in `ISSUES` and `REPORT_LOG` (prefer an idempotent readback).
4. Inspect `Triggers`. If an existing time-driven sync trigger is present, **retain it** and check its latest result. Only create a new trigger if none exists and the currently saved `.gs` exposes an appropriate sync function; avoid overlapping schedules or duplicate triggers.
5. Confirm a scheduled run with a new, controlled record before claiming automatic synchronization. Do not resend the 2026-10-20 Teams report or duplicate the existing REPORT_LOG row.
6. Secure the `SHEETS_SYNC_SECRET` in Apps Script Script Properties; never put the value in this public repository, PR, spreadsheet, or a chat message.

## Production readiness gates for 08:00 reporting

The Teams chat received the Supabase-generated report for 2026-10-20 at 19:40 on 21 Oct (Supabase dispatch SENT, Power Automate flow Succeeded, Teams card visible). That send is complete and must not be repeated. One controlled **real LINE group message** and verified no-duplicate Apps Script synchronization remain outstanding. GitHub's daily schedule must remain disabled and the PR must remain Draft until those gates are complete.
