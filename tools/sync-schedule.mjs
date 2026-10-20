#!/usr/bin/env node
/** node tools/sync-schedule.mjs [reviewed-assistant-services.json] */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FEED_URL, syncParishSchedule } from './lib/parish-feed.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`Usage: node tools/sync-schedule.mjs [reviewed-assistant-services.json]\nDefault source: ${FEED_URL}\nOutput: data/parish-schedule.json. No build or publication is performed.`);
    return;
  }
  if (args.length > 1 || (args[0] && (args[0].startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(args[0])))) {
    throw new Error('Expected no arguments or one local reviewed JSON file path; source URLs cannot be overridden.');
  }
  const snapshot = await syncParishSchedule({
    outputPath: fileURLToPath(new URL('../data/parish-schedule.json', import.meta.url)),
    inputPath: args[0] ? resolve(args[0]) : null
  });
  console.log(`Imported ${snapshot.events.length} published Paschal events. Source updated ${snapshot.sourceUpdatedAt}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
