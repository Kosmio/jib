'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/captcha/challenge',
      handler: 'captcha.challenge',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
