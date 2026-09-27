// Extracts the node descriptions Flow Builder emits from a published n8n-nodes-base tarball,
// so test/n8n-schema.test.ts can check every generated parameter against n8n's own definitions.
//
//   curl -sL https://registry.npmjs.org/n8n-nodes-base/-/n8n-nodes-base-<ver>.tgz | tar -xz package/dist/types/nodes.json
//   node scripts/extract-n8n-fixture.mjs package/dist/types/nodes.json <ver>
import { readFileSync, writeFileSync } from 'node:fs';

const [src, version = 'unknown'] = process.argv.slice(2);
if (!src) throw new Error('usage: extract-n8n-fixture.mjs <nodes.json> [n8n-nodes-base version]');
const WANT = {
  scheduleTrigger: 1.2, webhook: 2, rssFeedReadTrigger: 1, formTrigger: 2.2, googleSheetsTrigger: 1,
  httpRequest: 4.2, if: 2.2, set: 3.4, wait: 1.1, merge: 3, telegram: 1.2, slack: 2.3, discord: 2,
  emailSend: 2.1, googleSheets: 4.5, postgres: 2.5,
};
const all = JSON.parse(readFileSync(src, 'utf8'));
const out = { source: `n8n-nodes-base@${version}`, nodes: {} };
for (const [name, v] of Object.entries(WANT)) {
  const d = all.find((x) => x.name === name && [].concat(x.version).includes(v));
  if (!d) throw new Error(`${name}@${v} not found`);
  out.nodes[`n8n-nodes-base.${name}`] = { version: d.version, properties: d.properties, credentials: d.credentials ?? [] };
}
writeFileSync(new URL('../test/fixtures/n8n-nodes.json', import.meta.url), JSON.stringify(out));
console.log('wrote test/fixtures/n8n-nodes.json from', out.source);
