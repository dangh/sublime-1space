'use strict';

function dump(obj) {
  console.log(require('util').inspect(obj, { colors: true, depth: null, maxArrayLength: null }));
}

//dump and die
function dd(obj) {
  dump(obj);
  process.exit(0);
}

module.exports = {
  dump,
  dd,
};
