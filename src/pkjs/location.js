var CLAY_SETTINGS_KEY = 'clay-settings';

function parseNumber(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  var number = Number(value);
  return isFinite(number) ? number : null;
}

function isManualEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function coordinatesFromSettings(settings) {
  if (!settings || !isManualEnabled(settings.MANUAL_LOCATION)) {
    return null;
  }

  var latitude = parseNumber(settings.MANUAL_LATITUDE);
  var longitude = parseNumber(settings.MANUAL_LONGITUDE);
  if (latitude === null || longitude === null ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180) {
    return null;
  }

  return {
    latitude: latitude,
    longitude: longitude
  };
}

function readSettings(storage) {
  try {
    return JSON.parse(storage.getItem(CLAY_SETTINGS_KEY)) || {};
  } catch (error) {
    console.log('Could not read location settings: ' + error.message);
    return {};
  }
}

function getManualLocation(storage) {
  var settings = readSettings(storage);
  return {
    enabled: isManualEnabled(settings.MANUAL_LOCATION),
    coordinates: coordinatesFromSettings(settings)
  };
}

module.exports = {
  coordinatesFromSettings: coordinatesFromSettings,
  getManualLocation: getManualLocation,
  isManualEnabled: isManualEnabled
};
