import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchemas } from '../dist/library/index.js';

// Write the editor JSON Schemas shipped in schemas/ from the built library's canonical Zod
// contracts (src/core/schemas.ts). tests/core/schemas.test.ts rejects drift from the sources.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'schemas');
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries(jsonSchemas()))
  await writeFile(path.join(directory, name), JSON.stringify(schema, null, 2) + '\n');
console.log(`Wrote ${Object.keys(jsonSchemas()).length} JSON Schemas to schemas/.`);
