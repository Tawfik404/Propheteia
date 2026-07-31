import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fineFuelMoistureCode } from '../src/services/fwi/ffmc.js';
import { duffMoistureCode } from '../src/services/fwi/dmc.js';
import { droughtCode } from '../src/services/fwi/dc.js';
import { initialSpreadIndex } from '../src/services/fwi/isi.js';
import { buildupIndex } from '../src/services/fwi/bui.js';
import { fireWeatherIndex } from '../src/services/fwi/fwi.js';
import { fwiService } from '../src/services/fwi/fwi.service.js';
import { mapFwiToRisk } from '../src/services/alerts/risk.mapper.js';
import { validateCoordinates } from '../src/utils/geo.js';
import { BadRequestError } from '../src/utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Official day-1 outputs for the standard test dataset (Van Wagner &
 * Pickett 1985): temp=17, rh=42, ws=25, prec=0, startup FFMC=85, DMC=6,
 * DC=15, lat=40, month=4. Values are the official cffdrs results.
 */
const DAY_ONE = {
  input: { temperature: 17, humidity: 42, windSpeed: 25, rainfall24h: 0 },
  previous: { ffmc: 85, dmc: 6, dc: 15 },
  options: { lat: 40, month: 4 },
  expected: { ffmc: 87.65, dmc: 8.545, dc: 19.01, isi: 10.78, bui: 8.49, fwi: 10.04 },
};

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

test('FFMC reproduces the official day-1 value', () => {
  const { input, previous, options } = DAY_ONE;
  const value = fineFuelMoistureCode(previous.ffmc, input.temperature, input.humidity, input.windSpeed, input.rainfall24h);
  assert.ok(Math.abs(value - DAY_ONE.expected.ffmc) < 0.01, `got ${value}`);
});

test('DMC reproduces the official day-1 value', () => {
  const { input, previous, options } = DAY_ONE;
  const value = duffMoistureCode(previous.dmc, input.temperature, input.humidity, input.rainfall24h, options.lat, options.month);
  assert.ok(Math.abs(value - DAY_ONE.expected.dmc) < 0.001, `got ${value}`);
});

test('DC reproduces the official day-1 value', () => {
  const { input, previous, options } = DAY_ONE;
  const value = droughtCode(previous.dc, input.temperature, input.humidity, input.rainfall24h, options.lat, options.month);
  assert.ok(Math.abs(value - DAY_ONE.expected.dc) < 0.01, `got ${value}`);
});

test('ISI reproduces the official day-1 value', () => {
  const value = initialSpreadIndex(DAY_ONE.expected.ffmc, 25);
  assert.ok(Math.abs(value - DAY_ONE.expected.isi) < 0.01, `got ${value}`);
});

test('BUI reproduces the official day-1 value', () => {
  const value = buildupIndex(DAY_ONE.expected.dmc, DAY_ONE.expected.dc);
  assert.ok(Math.abs(value - DAY_ONE.expected.bui) < 0.001, `got ${value}`);
});

test('FWI reproduces the official day-1 value', () => {
  const value = fireWeatherIndex(DAY_ONE.expected.isi, DAY_ONE.expected.bui);
  assert.ok(Math.abs(value - DAY_ONE.expected.fwi) < 0.01, `got ${value}`);
});

test('sequential run matches all official cffdrs outputs within 0.2', () => {
  const input = parseCsv('test_fwi.csv', 9);
  const expected = parseCsv('fwi_expected.csv', 16);
  const prev = { ffmc: 85, dmc: 6, dc: 15 };
  const fields = ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'];

  for (let i = 0; i < input.length; i++) {
    const [long, lat, yr, mon, day, temp, rh, ws, prec] = input[i];
    const indices = fwiService.computeDaily(
      { temperature: temp, humidity: rh, windSpeed: ws, rainfall24h: prec },
      prev,
      { lat, month: mon }
    );
    prev.ffmc = indices.ffmc;
    prev.dmc = indices.dmc;
    prev.dc = indices.dc;

    for (let f = 0; f < fields.length; f++) {
      const field = fields[f];
      assert.ok(
        Math.abs(indices[field] - expected[i][9 + f]) < 0.2,
        `day ${i} ${field}: got ${indices[field]}, expected ${expected[i][9 + f]}`
      );
    }
  }
});

test('FWI=0 maps to Very Low / 0%', () => {
  const risk = mapFwiToRisk(0);
  assert.equal(risk.riskLevel, 'Very Low');
  assert.equal(risk.fireProbability, 0);
});

test('FWI=5 maps to Very Low / 20%', () => {
  const risk = mapFwiToRisk(5);
  assert.equal(risk.riskLevel, 'Very Low');
  assert.equal(risk.fireProbability, 20);
});

test('FWI=12 maps to Low / 40%', () => {
  const risk = mapFwiToRisk(12);
  assert.equal(risk.riskLevel, 'Low');
  assert.equal(risk.fireProbability, 40);
});

test('FWI=21 maps to Moderate / 60%', () => {
  const risk = mapFwiToRisk(21);
  assert.equal(risk.riskLevel, 'Moderate');
  assert.equal(risk.fireProbability, 60);
});

test('FWI=38 maps to High / 80%', () => {
  const risk = mapFwiToRisk(38);
  assert.equal(risk.riskLevel, 'High');
  assert.equal(risk.fireProbability, 80);
});

test('FWI=50 maps to Extreme and interpolates probability within 80-100%', () => {
  const risk = mapFwiToRisk(50);
  assert.equal(risk.riskLevel, 'Extreme');
  assert.ok(risk.fireProbability >= 80 && risk.fireProbability <= 100);
});

test('FWI is interpolated inside the Moderate band', () => {
  const low = mapFwiToRisk(12.5).fireProbability;
  const mid = mapFwiToRisk(16.5).fireProbability;
  assert.ok(low > 40 && low < 60);
  assert.ok(mid > low && mid < 60);
});

test('validateCoordinates rejects missing parameters', () => {
  assert.throws(() => validateCoordinates(undefined, undefined), BadRequestError);
});

test('validateCoordinates rejects out-of-range values', () => {
  assert.throws(() => validateCoordinates(91, 0), BadRequestError);
  assert.throws(() => validateCoordinates(0, -181), BadRequestError);
});

test('validateCoordinates rejects non-numeric values', () => {
  assert.throws(() => validateCoordinates('abc', '10'), BadRequestError);
});

test('validateCoordinates accepts valid coordinates', () => {
  assert.deepEqual(validateCoordinates('31.63', '-8.01'), { lat: 31.63, lon: -8.01 });
});
