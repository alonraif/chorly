// maplibre-gl 6 runs its tile worker from a separate module file, which the Next bundle doesn't ship.
// Copy it next to the other vendored map file; family-map.tsx points maplibre at it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs');
mkdirSync(new URL('../public/vendor/', import.meta.url), { recursive: true });
copyFileSync(source, new URL('../public/vendor/maplibre-gl-worker.mjs', import.meta.url));
