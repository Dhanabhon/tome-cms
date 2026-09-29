import assert from 'node:assert/strict';
import { test } from 'node:test';

import { updateDurations } from '../../src/lib/update-timeline';

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 7, 50, 0) + seconds * 1000).toISOString();

test('the site was offline from maintenance to the end, and the backup took its own share', () => {
  const timeline = [
    { phase: 'preflight', at: at(-40) }, { phase: 'downloading', at: at(-30) }, { phase: 'quiescing', at: at(0) },
    { phase: 'backing_up', at: at(2) }, { phase: 'migrating', at: at(5) }, { phase: 'restarting', at: at(6) },
    { phase: 'health_check', at: at(20) }, { phase: 'succeeded', at: at(21) },
  ];
  assert.deepEqual(updateDurations({ finishedAt: at(21), phase: 'succeeded' }, { backupKind: 'database', timeline }),
    { backupKind: 'database', backupSeconds: 3, offlineSeconds: 21 });
});

test('a rolled-back update was offline until the previous version was back', () => {
  const timeline = [{ phase: 'quiescing', at: at(0) }, { phase: 'backing_up', at: at(1) }, { phase: 'rolling_back', at: at(8) }, { phase: 'rolled_back', at: at(30) }];
  assert.deepEqual(updateDurations({ finishedAt: at(30), phase: 'rolled_back' }, { backupKind: null, timeline }),
    { backupKind: null, backupSeconds: 7, offlineSeconds: 30 });
});

test('nothing is claimed that was not measured', () => {
  assert.equal(updateDurations({ finishedAt: at(10), phase: 'succeeded' }, null), null, 'an updater from before 1.3.0');
  assert.equal(updateDurations({ finishedAt: at(10), phase: 'succeeded' }, { backupKind: null, timeline: [] }), null, 'a job it did not time');
  assert.equal(updateDurations({ finishedAt: null, phase: 'migrating' }, { backupKind: 'full', timeline: [{ phase: 'quiescing', at: at(0) }] }), null, 'still running');
  assert.deepEqual(updateDurations({ finishedAt: at(5), phase: 'rolled_back' }, { backupKind: null, timeline: [{ phase: 'preflight', at: at(0) }] }), null, 'stopped before the site went down');
});
