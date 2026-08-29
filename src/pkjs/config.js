module.exports = [
  {
    type: 'heading',
    defaultValue: 'Rain Radar Settings'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Location'
      },
      {
        type: 'toggle',
        messageKey: 'MANUAL_LOCATION',
        label: 'Use manual location',
        description: 'When disabled, Rain Radar uses your phone\'s location.',
        defaultValue: false
      },
      {
        type: 'input',
        messageKey: 'MANUAL_LATITUDE',
        label: 'Latitude',
        description: 'A number from -90 to 90.',
        defaultValue: '',
        attributes: {
          type: 'number',
          min: '-90',
          max: '90',
          step: 'any',
          placeholder: 'e.g. 54.623'
        }
      },
      {
        type: 'input',
        messageKey: 'MANUAL_LONGITUDE',
        label: 'Longitude',
        description: 'A number from -180 to 180.',
        defaultValue: '',
        attributes: {
          type: 'number',
          min: '-180',
          max: '180',
          step: 'any',
          placeholder: 'e.g. -1.302'
        }
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Test Tile Server'
      },
      {
        type: 'input',
        messageKey: 'TILE_SERVER_URL',
        label: 'Server URL',
        description: 'Optional. Enter the base URL of the Pebble tile server. Leave blank to use the normal OpenStreetMap map.',
        defaultValue: '',
        attributes: {
          type: 'url',
          placeholder: 'http://192.168.1.10:8080'
        }
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Save Settings'
  }
];
