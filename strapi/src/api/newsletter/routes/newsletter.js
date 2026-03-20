'use strict';

module.exports = {
  routes: [
    {
     method: 'POST',
     path: '/newsletter/subscribe',
     handler: 'newsletter.subscribe',
     config: {
       policies: [],
       middlewares: [],
     },
    },
  ],
};
