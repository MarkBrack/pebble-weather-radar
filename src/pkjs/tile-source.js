var CLAY_SETTINGS_KEY = 'clay-settings';

function normalizeServerUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  var normalized = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function serverUrlFromSettings(settings) {
  return normalizeServerUrl(settings && settings.TILE_SERVER_URL);
}

function getServerUrl(storage) {
  try {
    var settings = JSON.parse(storage.getItem(CLAY_SETTINGS_KEY)) || {};
    return serverUrlFromSettings(settings);
  } catch (error) {
    console.log('Could not read tile server setting: ' + error.message);
    return null;
  }
}

function normalizeServerToken(value) {
  if (typeof value !== 'string') return null;
  var normalized = value.trim();
  return normalized || null;
}

function getServerToken(storage) {
  try {
    var settings = JSON.parse(storage.getItem(CLAY_SETTINGS_KEY)) || {};
    return normalizeServerToken(settings.TILE_SERVER_TOKEN);
  } catch (error) {
    console.log('Could not read tile server token: ' + error.message);
    return null;
  }
}

module.exports = {
  normalizeServerUrl: normalizeServerUrl,
  normalizeServerToken: normalizeServerToken,
  serverUrlFromSettings: serverUrlFromSettings,
  getServerUrl: getServerUrl,
  getServerToken: getServerToken
};
