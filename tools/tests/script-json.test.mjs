import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptJSON } from '../lib/script-json.mjs';

test('Untrusted JSON-LD titles cannot close the script element and still round-trip', () => {
  const data = { name: '</script><script>alert(1)</script>', note: '<!-- <img src=x onerror=alert(1)>', translated: 'Пасха & Velykos' };
  const json = scriptJSON(data);
  assert.equal(json.includes('<'), false, 'HTML parser must never see a new tag or comment');
  assert.deepEqual(JSON.parse(json), data, 'source text must survive unchanged');
});
