const migrationInventoryScript = "import { migrations } from '/app/src/server/db/migrator.ts'; process.stdout.write(JSON.stringify(Object.keys(migrations)));";

// The `docker run` arguments, after `--rm --name <name>`, that list the migrations an image
// ships. The container gets no network, no capabilities and a read-only filesystem, except a
// small in-memory /tmp: tsx compiles into it, and without it the list failed on every server.
// The installer and the updater share this, so the two cannot drift apart again.
export function migrationInventoryArgs(image: string): string[] {
  return [
    '--pull', 'never', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', image,
    '--import', 'tsx', '--input-type=module', '-e', migrationInventoryScript,
  ];
}
