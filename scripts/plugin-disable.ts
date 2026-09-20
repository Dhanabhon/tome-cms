export {};

/**
 * Switches a plugin off from a shell, for the case where the plugin is what stands between
 * the owner and the admin they would otherwise switch it off from.
 *
 * `--forget` clears its settings as well. The admin cannot: a blank field there means
 * "keep what is stored", so that saving the rest of a form does not erase a secret the
 * browser was never given -- which leaves no way, in the admin, to say "remove it".
 */
const [, , id, ...flags] = process.argv;
const forget = flags.includes('--forget');

const { PLUGIN_MANIFESTS, pluginManifest } = await import('../src/plugins/manifests');
if (!id || !pluginManifest(id)) {
  console.error(`Usage: npm run plugin:disable <id> [-- --forget]\nInstalled: ${PLUGIN_MANIFESTS.map(({ id: known }) => known).join(', ')}`);
  process.exitCode = 1;
} else {
  try {
    const { closeDatabase, db } = await import('../src/server/db/client');
    let report: string;
    try {
      const { getSiteSettings } = await import('../src/server/content/site-settings');
      const settings = await getSiteSettings();
      if (!settings) throw new Error('not installed');
      const result = await db.updateTable('plugin_settings')
        .set(forget ? { enabled: false, settings: '{}' } : { enabled: false })
        .where('id', '=', id).where('owner_id', '=', settings.owner_id)
        .executeTakeFirst();
      report = Number(result.numUpdatedRows) === 0
        ? `${id} was not switched on.`
        : `${id} is off${forget ? ', and its settings are cleared' : ''}.`;
    } finally {
      await closeDatabase();
    }
    console.log(report);
  } catch (error) {
    console.error(error instanceof Error && error.message === 'not installed'
      ? 'TomeCMS is not installed yet: there are no plugins to switch off.'
      : 'The plugin could not be switched off.');
    process.exitCode = 1;
  }
}
