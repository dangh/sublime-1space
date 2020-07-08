'use strict';

const path = require('path');

const rootDir = (uri) => path.resolve('../', uri);
const sourceDir = (uri) => path.resolve('./src', uri);

module.exports = {
  rootDir,
  sourceDir,
};
