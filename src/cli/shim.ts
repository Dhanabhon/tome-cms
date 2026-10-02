/** Where `tome` is installed, and what it is: two lines that run the CLI built with the updater. */
export const TOME_SHIM_PATH = '/usr/local/bin/tome';
export const TOME_SHIM = '#!/bin/sh\nexec /usr/bin/node /opt/tome-cms/updater/cli/main.js "$@"\n';
