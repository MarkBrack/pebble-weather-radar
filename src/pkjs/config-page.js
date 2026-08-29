module.exports = function() {
  var config = this;

  config.on(config.EVENTS.AFTER_BUILD, function() {
    var form = document.getElementById('main-form');
    var manual = config.getItemByMessageKey('MANUAL_LOCATION');
    var latitude = config.getItemByMessageKey('MANUAL_LATITUDE');
    var longitude = config.getItemByMessageKey('MANUAL_LONGITUDE');

    form.addEventListener('submit', function(event) {
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
