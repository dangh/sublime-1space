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

  let texturesToBuild = process.argv.slice(2).filter(name => !name.startsWith('-'));
  if(texturesToBuild.length == 0) texturesToBuild = Object.keys(textures);

  let tasks = [];
  let defaultCss = `svg * { fill: white; }`;
  for(let texture of texturesToBuild) {
    let { svg, width, height, padding, css = defaultCss } = textures[texture];
    if(texture.startsWith('$')) continue;
    if(!width) throw new Error(`Invalid texture metadata: \`width\` is missing for \`${texture}\``);
    if(!height) height = width;
    if(svg.raw && svg.variables) svg.raw = EJS.render(svg.raw, svg.variables, { _with: true });
    tasks.push({
      name: texture,
      input: {
        svg,
        width,
        height,
        padding,
      },
      outputs: [
        { css, scale: 1, paths: [rootDir(`img/${texture}.png`)] },
        { css, scale: 2, paths: [rootDir(`img/${texture}@2x.png`)] },
        { css, scale: 3, paths: [rootDir(`img/${texture}@3x.png`)] },
      ]
    });
  }
  (await SVG.toPNG(tasks));
}
