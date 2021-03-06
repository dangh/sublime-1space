'use strict';

const fs = require('fs').promises;
const deepmerge = require('deepmerge');
const YAML = require('js-yaml');
const EJS = require('ejs')
const SVG = require('./svg');
const log = require('./log');
const { rootDir } = require('./path');

main().then(log.error);

async function main() {
  let textures = (await YAML.load(await fs.readFile('./textures.yml', 'utf8')));

  //resolve refs
  for(let [name, texture] of Object.entries(textures)) {
    if(texture.ref) {
      let ref = textures[texture.ref];
      textures[name] = deepmerge(ref, texture);
    }
  }

  let texturesToBuild = process.argv.slice(2);
  if(texturesToBuild.length == 0) texturesToBuild = Object.keys(textures);

  let tasks = {};
  let defaultCss = `svg * { fill: white; }`;
  for(let texture of texturesToBuild) {
    let { svg, width, height, padding, css = defaultCss } = textures[texture];
    if(texture.startsWith('$')) continue;
    if(!width) throw new Error(`Invalid texture metadata: \`width\` is missing for \`${texture}\``);
    if(!height) height = width;
    if(svg.raw && svg.variables) svg.raw = EJS.render(svg.raw, svg.variables, { _with: true });
    tasks[texture] = {
      input: svg,
      outputs: {
        [rootDir(`img/${texture}.png`)]: { width, height, padding, css, scale: 1 },
        [rootDir(`img/${texture}@2x.png`)]: { width, height, padding, css, scale: 2 },
        [rootDir(`img/${texture}@3x.png`)]: { width, height, padding, css, scale: 3 },
      }
    };
  }
  (await SVG.toPNG(tasks));
}
