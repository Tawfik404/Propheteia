/**
 * Shared prediction payload composer.
 *
 * Both the per-point prediction service and the viewport grid engine
 * produce the exact same JSON shape, so the REST layer, the socket
 * transport and the frontend never see a difference between an
 * on-demand prediction and a grid cell prediction.
 */

/**
 * Build a full prediction payload.
 *
 * @param {object} input
 * @param {number} input.lat - rounded latitude
 * @param {number} input.lon - rounded longitude
 * @param {object} input.weather - normalized weather payload
 * @param {object} input.indices - computed FWI indices { ffmc, dmc, dc, isi, bui, fwi, dsr }
 * @param {object} input.risk - risk mapping { fwi, riskLevel, fireProbability }
 * @param {string} input.date - local YYYY-MM-DD of the computation
 * @param {{date: string|null}|null} [input.previous] - previous fuel state
 * @param {string|null} [input.name] - human-readable location name
 * @param {object|null} [input.landCover] - terrain classification
 *        { type, flammable, vegetationCoverage } or null when unknown
 * @returns {object} prediction payload (see README)
 */
export function composePrediction({
  lat,
  lon,
  weather,
  indices,
  risk,
  date,
  previous = null,
  name = null,
  landCover = null,
}) {
  return {
    latitude: lat,
    longitude: lon,
    predictedAt: new Date().toISOString(),
    name,
    landCover: landCover
      ? {
          type: landCover.type,
          flammable: landCover.flammable,
          vegetationCoverage:
            Number.isFinite(Number(landCover.vegetationCoverage))
              ? Math.round(Number(landCover.vegetationCoverage))
              : null,
        }
      : null,
    weather: {
      temperature: weather.temperature,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      precipitation: weather.precipitation,
      rainfall24h: weather.rainfall24h,
      weatherCode: weather.weatherCode,
      observedAt: weather.observedAt,
      provider: weather.provider,
      cached: weather.cached,
    },
    indices: {
      FFMC: Number(indices.ffmc.toFixed(1)),
      DMC: Number(indices.dmc.toFixed(1)),
      DC: Number(indices.dc.toFixed(1)),
      ISI: Number(indices.isi.toFixed(1)),
      BUI: Number(indices.bui.toFixed(1)),
      FWI: risk.fwi,
      DSR: Number(indices.dsr.toFixed(2)),
    },
    riskLevel: risk.riskLevel,
    fireProbability: risk.fireProbability,
    state: {
      date,
      previousDate: previous?.date ?? null,
      usedStartupValues: !previous?.date,
    },
  };
}
