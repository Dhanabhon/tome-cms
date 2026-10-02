/** Where the updater, and the CLI built with it, are installed. */
export const UPDATER_INSTALL_DIRECTORY = '/opt/tome-cms/updater';
/** Where `tome` is installed, and what it is: two lines that run the CLI built with the updater. */
export const TOME_SHIM_PATH = '/usr/local/bin/tome';
export const TOME_SHIM = `#!/bin/sh\nexec /usr/bin/node ${UPDATER_INSTALL_DIRECTORY}/cli/main.js "$@"\n`;
