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
    'countryId', 
    'clout',
    'cloutCategory',
    'optIn',
    'mergedFrom',
    'mergedTo'
  ]
};
