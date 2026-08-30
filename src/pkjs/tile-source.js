var PRODUCTION_SERVER_URL = 'https://ada.tailadb379.ts.net:8443/weather-radar';

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

function getServerUrl() {
  return PRODUCTION_SERVER_URL;
}

module.exports = {
  PRODUCTION_SERVER_URL: PRODUCTION_SERVER_URL,
  normalizeServerUrl: normalizeServerUrl,
  getServerUrl: getServerUrl
};
