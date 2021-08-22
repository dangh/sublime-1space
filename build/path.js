'use strict';

const path = require('path');

const rootDir = (uri) => path.resolve(__dirname, '..', uri);
const sourceDir = (uri) => path.resolve(__dirname, 'src', uri);
const buildDir = (uri) => path.resolve(__dirname, uri);

module.exports = {
  rootDir,
  sourceDir,
  buildDir,
};
