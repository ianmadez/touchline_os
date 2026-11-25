/**
 * Whether to nudge the manager to export a backup, as a build-time switch point.
 *
 * The local Node build keeps its database on disk, so a cleared browser cache costs it nothing. The
 * browser build keeps everything in the browser's own storage, which "clear browsing data" wipes, so
 * it substitutes `backup-reminder.browser.ts` and shows the reminder.
 */
export const showBackupReminder = false;
