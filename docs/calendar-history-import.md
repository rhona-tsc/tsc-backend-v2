# Calendar history import

A native Google Calendar export preserves the complete owned-calendar archive, including attendee response status and recurring-event exceptions. Raw calendar entries live in the private `calendarhistoryevents` collection; they have no public endpoint. Public profiles consume only verified musician IDs from `musicianperformancehistories`.

Normalize the ZIP with Python packages `icalendar` and `recurring-ical-events` in a separate virtual environment:

```sh
python scripts/normalizeCalendarHistoryExport.py /absolute/path/export.zip --before=2026-11-26 --output-prefix=/private/path/calendar
```

Review the dry run with the backend database connection in the environment:

```sh
node scripts/backfillMusicianPerformanceHistory.js --input=/private/path/calendar-performances.json --archive-input=/private/path/calendar-raw.json --replace-calendars --report=/private/path/review.json
```

Add `--apply` only after reviewing the results. `--replace-calendars` is exclusively for a complete native export: it supersedes older evidence for all covered calendars from 2000 to the import day, retaining previous rows for audit. Partial connector imports must omit that flag. Repeat imports upsert the same archive/evidence keys and record their content hash in `calendarhistoryimports`.

Matching uses canonical profile IDs, accepted performance invitations, final confirmed allocations and older email addresses explicitly attached to saved musician IDs. Current allocations override calendar guests. Ambiguous identities, unanswered/declined invitations, availability calendars, cancelled events and personal calendar entries without performance evidence do not create public relationships. Pending or hidden profiles stay hidden; the import never approves profiles, changes allocations or sends messages.

The complete archive includes future events; derived performed-with relationships use past events only. New booking allocations continue to appear automatically after completed gigs. A calendar-only historical import does not create an ongoing calendar synchronizer.
