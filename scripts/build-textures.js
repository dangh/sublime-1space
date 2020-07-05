'use strict';

const fs = require('fs').promises;
const YAML = require('js-yaml');
const SVG = require('./svg');
const log = require('./log');

main().then(log.error);

async function main() {
  let textures = (await YAML.load(await fs.readFile('./textures.yml', 'utf8')));

  let texturesToBuild = process.argv.slice(2);
  if(texturesToBuild.length == 0) texturesToBuild = Object.keys(textures);

  let tasks = {};
  let defaultCss = `svg * { fill: white; }`;
  for(let texture of texturesToBuild) {
    let { svg, width, height, padding, css = defaultCss, ignore } = textures[texture];
    if(ignore) continue;
    if(!width) throw new Error(`Invalid texture metadata: \`width\` is missing for \`${texture}\``);
    if(!height) height = width;
    tasks[texture] = {
      input: svg,
      outputs: {
        [`../img/${texture}.png`]: { width, height, padding, css, scale: 1 },
        [`../img/${texture}@2x.png`]: { width, height, padding, css, scale: 2 },
        [`../img/${texture}@3x.png`]: { width, height, padding, css, scale: 3 },
      }
    };
  }
  (await SVG.toPNG(tasks));
}
