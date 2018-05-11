"use strict";

module.exports = {
  "*": [
    'password', 
    'deleted',
    'createdAt',
    'updatedAt'
  ],
  "customer.*": [
    'credentials', 
    'clout',
    'mergedFrom',
    'mergedTo'
  ]
};
