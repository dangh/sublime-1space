'use strict';

const util = require('util');

const color = {
  warn: s => `\u001b[33m${s}\u001b[0m`,
  info: s => `\u001b[32m${s}\u001b[0m`,
  debug: s => `\u001b[34m${s}\u001b[0m`,
  error: s => `\u001b[31m${s}\u001b[0m`,
}

function log(level, ...args) {
  args = args.map(arg => {
    if(typeof arg == 'object') return util.inspect(arg, { colors: true, depth: null, maxArrayLength: null });
    if(typeof arg == 'string') return color[level](arg);
    return arg;
  });
  console[level].apply(console, args);
}

//dump and die
function dd(...args) {
  log('debug', ...args);
  process.exit(0);
}

module.exports = {
  info: log.bind(null, 'info'),
  warn: log.bind(null, 'warn'),
  error: log.bind(null, 'error'),
  debug: log.bind(null, 'debug'),
  dd,
};
