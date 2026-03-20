'use strict';

module.exports = {
  routes: [
    {
     method: 'POST',
     path: '/contact/send',
     handler: 'contact.send',
     config: {
       policies: [],
       middlewares: [],
     },
    },
  ],
};
