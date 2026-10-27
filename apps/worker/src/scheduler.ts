import { spawn } from 'node:child_process';
import path from 'node:path';
import cron from 'node-cron';
import { TZ } from './lib/config';

// Each job runs its script in a child process so one failure can't take the scheduler down.
const jobs: Array<{ name: string; file: string; schedule: string }> = [
  { name: 'generate', file: 'generate.ts', schedule: process.env.CRON_GENERATE || '15 0 * * *' },
  { name: 'reminders-morning', file: 'reminders-morning.ts', schedule: process.env.CRON_MORNING || '0 7 * * *' },
  { name: 'due-soon', file: 'due-soon.ts', schedule: process.env.CRON_DUE_SOON || '*/5 * * * *' },
  { name: 'overdue-nags', file: 'overdue-nags.ts', schedule: process.env.CRON_OVERDUE || '0 17,20 * * *' },
  { name: 'parent-nag', file: 'parent-nag.ts', schedule: process.env.CRON_PARENT_NAG || '0 20 * * *' },
  { name: 'weekly-summary', file: 'weekly-summary.ts', schedule: process.env.CRON_WEEKLY || '0 19 * * 6' },
];

const running = new Set<string>();

function run(name: string, file: string) {
  if (running.has(name)) {
    console.log(`[scheduler] ${name} still running, skip`);
    return;
  }
  running.add(name);
  console.log(`[scheduler] ${name} start`);
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, file)], { stdio: 'inherit' });
  child.on('exit', (code) => {
    running.delete(name);
    console.log(`[scheduler] ${name} exit ${code}`);
  });
}

for (const job of jobs) {
  cron.schedule(job.schedule, () => run(job.name, job.file), { timezone: TZ });
  console.log(`[scheduler] ${job.name} @ "${job.schedule}" (${TZ})`);
}

// Fill the upcoming window right away so new chores show up after a restart.
run('generate', 'generate.ts');
