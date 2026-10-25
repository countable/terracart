// WeatherAPI condition codes share one mapping between the relay and client
// tests, so precipitation art cannot drift from the server response.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeatherCodes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // WeatherAPI publishes this stable code list at:
  // https://www.weatherapi.com/docs/weather_conditions.json
  // The relay also requires current.precip_mm > 0 because "possible" codes do
  // not mean precipitation is falling at the player's position.
  const CODES = Object.freeze({
    drizzle: Object.freeze([1072, 1150, 1153, 1168, 1171]),
    rain: Object.freeze([1063, 1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246, 1273, 1276]),
    sleet: Object.freeze([1069, 1198, 1201, 1204, 1207, 1237, 1249, 1252, 1261, 1264]),
    snow: Object.freeze([1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258, 1279, 1282]),
  });
  // Obscured-sky codes have no falling precipitation, so they only label the readout.
  const SKY = Object.freeze({ fog: Object.freeze([1135, 1147]), mist: Object.freeze([1030]) });
  const KIND_BY_CODE = new Map(Object.entries(CODES).flatMap(([kind, codes]) => codes.map(code => [code, kind])));
  const SKY_BY_CODE = new Map(Object.entries(SKY).flatMap(([label, codes]) => codes.map(code => [code, label])));

  function kindFor(code, precipMm) {
    if (!(Number(precipMm) > 0)) return 'none';
    return KIND_BY_CODE.get(Number(code)) || 'none';
  }

  // One lower-case word for the readout: falling precipitation first, then fog
  // or mist; clear and cloudy skies return '' so nothing is shown.
  function labelFor(code, precipMm) {
    const kind = kindFor(code, precipMm);
    return kind !== 'none' ? kind : SKY_BY_CODE.get(Number(code)) || '';
  }

  return { CODES, SKY, kindFor, labelFor };
});
