'use strict';

// Badges (F-97, F-98, I-43): pure helpers and the PDF layout. No Strapi, no network.
module.exports = {
  ...require('./colors'),
  ...require('./layout'),
  ...require('./program'),
  ...require('./qr'),
  ...require('./text'),
  ...require('./token'),
  ...require('./types'),
};
