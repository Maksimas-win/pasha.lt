import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const languages = Object.keys(site.languages).filter((key) => !key.startsWith('_'));
const files = ['index.html', ...Object.values(site.pages).flatMap((page) =>
  languages.map((language) => page[language]).filter(Boolean))];
const pages = new Map(files.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]));

for (const mount of ['/', '/pasha.lt/']) {
  test(`generated navigation and resources stay inside ${mount}`, () => {
    const base = new URL(mount, 'https://example.test');
    for (const [file, html] of pages) {
      const pageURL = new URL(file.replace(/index\.html$/, ''), base);
      const links = html.matchAll(/\s(?:href|src|data-(?:meaning|schedule)-href)="([^"]*)"/g);
      for (const [, value] of links) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) continue;
        const target = new URL(value.replaceAll('&amp;', '&'), pageURL);
        const label = `${file}: ${value}`;
        assert.equal(target.origin, base.origin, label);
        assert.ok(target.pathname.startsWith(mount), `${label} escapes the site mount`);
        let path = decodeURIComponent(target.pathname.slice(mount.length));
        if (!path || path.endsWith('/')) path += 'index.html';
        assert.ok(existsSync(join(ROOT, path)), `${label} resolves to missing ${path}`);
        if (target.hash && pages.has(path)) {
          const id = decodeURIComponent(target.hash.slice(1));
          const ids = new Set([...pages.get(path).matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
          assert.ok(ids.has(id), `${label} has missing anchor on ${path}`);
        }
      }
    }
    const manifestURL = new URL('manifest.json', base);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    assert.equal(new URL(manifest.start_url, manifestURL).href, base.href);
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, manifestURL);
      assert.ok(url.pathname.startsWith(mount), `${icon.src} escapes the site mount`);
      assert.ok(existsSync(join(ROOT, url.pathname.slice(mount.length))), `missing icon ${icon.src}`);
    }
  });
}

test('canonical pages continue to use the production domain', () => {
  for (const [file, html] of pages) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
    assert.equal(canonical, site.siteUrl + '/' + file.replace(/index\.html$/, ''), file);
  }
});
