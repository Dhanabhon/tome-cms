/** Where the updater, and the CLI built with it, are installed. */
export const UPDATER_INSTALL_DIRECTORY = '/opt/tome-cms/updater';
/** Where `tome` is installed, and what it is: a script that runs the CLI built with the updater. */
export const TOME_SHIM_PATH = '/usr/local/bin/tome';
/** The line that marks a `tome` as TomeCMS's, whatever else a later release puts in it. */
export const TOME_SHIM_MARKER = '# tome — TomeCMS server command';
export const TOME_SHIM = `#!/bin/sh\n${TOME_SHIM_MARKER}\nexec /usr/bin/node ${UPDATER_INSTALL_DIRECTORY}/cli/main.js "$@"\n`;
