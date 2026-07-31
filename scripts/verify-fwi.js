/**
 * Verification script for the FWI implementation.
 *
 * Runs the sequential FWI System on the official test dataset from
 * Van Wagner & Pickett (1985) (the standard `test_fwi` dataset used by the
 * Canadian reference implementation `cffdrs`) and compares every output
 * against the official expected values.
 *
 * Usage:  node scripts/verify-fwi.js
 * Exit:   0 when all columns match within the tolerance, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fwiService } from '../src/services/fwi/fwi.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../test/fixtures');

const TOLERANCE = 0.2; // official outputs are rounded to 2-3 decimals

function parseCsv(file, minColumns) {
  const rows = fs
    .readFileSync(path.join(FIXTURES, file), 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1);
  return rows
    .map((line) => line.split(/[;,]/).map((v) => Number(v)))
    .filter((r) => r.length >= minColumns);
}

/** Sequential run with the official startup values (FFMC=85, DMC=6, DC=15). */
function runSequential(inputRows) {
  const prev = { ffmc: 85, dmc: 6, dc: 15 };
  const outputs = [];
  for (const [long, lat, yr, mon, day, temp, rh, ws, prec] of inputRows) {
    const indices = fwiService.computeDaily(
      { temperature: temp, humidity: rh, windSpeed: ws, rainfall24h: prec },
      prev,
      { lat, month: mon }
    );
    prev.ffmc = indices.ffmc;
    prev.dmc = indices.dmc;
    prev.dc = indices.dc;
    outputs.push({ mon, day, ...indices });
  }
  return outputs;
}

function main() {
  const input = parseCsv('test_fwi.csv', 9);
  const expected = parseCsv('fwi_expected.csv', 16);

  if (input.length !== expected.length) {
    console.error(`Row count mismatch: input=${input.length} expected=${expected.length}`);
    process.exit(1);
  }

  const fields = [
    ['ffmc', 9],
    ['dmc', 10],
    ['dc', 11],
    ['isi', 12],
    ['bui', 13],
    ['fwi', 14],
  ];

  const computed = runSequential(input);
  let worst = { field: '', deviation: 0, date: '' };
  let failures = 0;

  for (let i = 0; i < expected.length; i++) {
    const row = expected[i];
    for (const [field, col] of fields) {
      const actual = computed[i][field];
      const official = row[col];
      const deviation = Math.abs(actual - official);
      if (deviation > worst.deviation) {
        worst = { field, deviation, date: `${row[3]}-${row[4]}-${row[5]}` };
      }
      const ok = deviation <= TOLERANCE;
      if (!ok) {
        failures += 1;
        console.error(
          `MISMATCH ${field} on ${row[3]}-${row[4]}-${row[5]}: ` +
            `computed=${actual.toFixed(4)} official=${official}`
        );
      }
    }
  }

  console.log('FWI verification against official cffdrs outputs (Van Wagner & Pickett 1985):');
  console.log(`  rows: ${input.length}`);
  console.log(`  tolerance: ${TOLERANCE}`);
  console.log(`  worst deviation: ${worst.field} ${worst.deviation.toFixed(6)} (${worst.date})`);
  console.log(failures === 0 ? '  RESULT: PASS' : `  RESULT: FAIL (${failures} mismatches)`);

  // Also print the final day's values for reference.
  const last = computed[computed.length - 1];
  const lastExpected = expected[expected.length - 1];
  console.log('\nLast day (May 30) comparison:');
  for (const [field, col] of fields) {
    console.log(
      `  ${field.toUpperCase().padEnd(4)} computed=${last[field].toFixed(4)} ` +
        `official=${lastExpected[col]}`
    );
  }

  process.exit(failures === 0 ? 0 : 1);
}

main();
