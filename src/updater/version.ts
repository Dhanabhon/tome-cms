/**
 * The updater's own version. It is not the application's: the updater runs on the host, is built
 * once when the server is installed, and changes only when `npm run updater:upgrade` rebuilds it.
 * A release that needs a newer one says so in its manifest's `minimumUpdaterVersion`.
 */
export const UPDATER_VERSION = '1.4.0';
