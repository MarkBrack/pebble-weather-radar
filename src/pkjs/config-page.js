module.exports = function() {
  var config = this;

  config.on(config.EVENTS.AFTER_BUILD, function() {
    var form = document.getElementById('main-form');
    var manual = config.getItemByMessageKey('MANUAL_LOCATION');
    var latitude = config.getItemByMessageKey('MANUAL_LATITUDE');
    var longitude = config.getItemByMessageKey('MANUAL_LONGITUDE');
    var tileServer = config.getItemByMessageKey('TILE_SERVER_URL');

    form.addEventListener('submit', function(event) {
      var tileServerValue = (tileServer.get() || '').trim();
      if (tileServerValue && !/^https?:\/\/[^\s]+$/i.test(tileServerValue)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('Enter a complete tile server URL beginning with http:// or https://.');
        return;
      }

      if (!manual.get()) return;

      var latitudeValue = latitude.get();
      var longitudeValue = longitude.get();
      var lat = Number(latitudeValue);
      var lon = Number(longitudeValue);
      var valid = latitudeValue !== '' && longitudeValue !== '' &&
        isFinite(lat) && isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

      if (!valid) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('Enter a latitude from -90 to 90 and a longitude from -180 to 180.');
      }
    }, true);
  });
};
