// Writes deploy/apk/version.json next to the APK, from the versionCode and versionName in
// build.gradle. The app compares it with its own version to offer an update.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gradle = readFileSync(resolve(here, '../android/app/build.gradle'), 'utf8');
const versionCode = Number(gradle.match(/^\s*versionCode\s+(\d+)/m)?.[1]);
const versionName = gradle.match(/^\s*versionName\s+"([^"]+)"/m)?.[1];
if (!versionCode || !versionName) throw new Error('versionCode or versionName not found in build.gradle');

const out = resolve(here, '../../deploy/apk/version.json');
writeFileSync(out, JSON.stringify({ versionCode, versionName }) + '\n');
console.log(`Wrote ${out}: ${versionName} (${versionCode})`);
