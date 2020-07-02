'use strict';

const fs = require('fs').promises;
const path = require('path');
const lessToJs = require('less-vars-to-js');
const CSON = require('cson');
const CSS = require('css');
const LESS = require('less');
const TSV = require('tsv');
const YAML = require('js-yaml');
const SVG = require('./svg');
const { dump, dd } = require('./util');

const ICON_SIZE = 14;

main().catch(console.error);

async function main() {
  //get all icons supported by A File Icon
  let supportedIcons = await getSupportedIcons();
  dump({ supportedIcons });

  //extract all colors from Atom file-icons package
  let colors = await getColors();
  dump({ colors });

  //extract list of icons from Atom file-icons package
  let icons = await getIcons();
  dump({ icons });

  //build inject css map
  let injectCss = {};
  for(let color in colors) {
    injectCss[color] = `svg * { fill: ${colors[color]}; }`;
  }
  dump({ injectCss });

  //generate pngs
  let tasks = {};
  for(let [icon, { svg, color }] of Object.entries(icons)) {
    if(!supportedIcons.includes(icon)) {
      dump(`${icon} is not supported!`);
      continue;
    }
    if(!svg) {
      dump(`${icon} does not have svg source!`);
      continue;
    }
    let input = svg;
    if(input.filename) input.filename = path.resolve(input.filename);
    tasks[icon] = {
      input: svg,
      outputs: {
        [path.resolve('../icons/file_type_' + icon + '.png')]: { width: ICON_SIZE, height: ICON_SIZE, css: injectCss[color] },
        [path.resolve('../icons/file_type_' + icon + '@2x.png')]: { width: (ICON_SIZE * 2), height: (ICON_SIZE * 2), css: injectCss[color] },
        [path.resolve('../icons/file_type_' + icon + '@3x.png')]: { width: (ICON_SIZE * 3), height: (ICON_SIZE * 3), css: injectCss[color] },
      }
    }
  }
  dump({ tasks });
  await SVG.toPNG(tasks);
}

async function lessToCss(opts) {
  let source = opts, options = undefined;
  if(opts.filename) {
    source = await fs.readFile(opts.filename, 'utf8');
    options = opts;
  }
  let result = await LESS.render(source, options).catch(err => {
    console.error(err)
    throw err
  });
  return result.css;
}

async function getColors() {
  let less = await fs.readFile('../modules/atom/styles/colours.less', 'utf8');
  let variables = lessToJs(less, { resolveVariables: true, stripPrefix: true });
  less = '';
  for(let [variable, value] of Object.entries(variables)) {
    less += `@${variable}:${value};`;
    if(/^(medium|light|dark)/.test(variable)) {
      less += `.${variable}{color:@${variable}}`;
    }
  }
  let css = await lessToCss(less);
  let ast = await CSS.parse(css);
  let colors = {};
  for(let rule of ast.stylesheet.rules) {
    let name = rule.selectors[0].slice(1);
    let color = rule.declarations[0].value;
    colors[name] = color;
  }
  return colors;
}

async function getIcons() {
  let css = await lessToCss({ filename: '../modules/atom/styles/icons.less' });
  let ast = await CSS.parse(css);
  let rules = {};
  for(let rule of ast.stylesheet.rules) {
    if(rule.type != 'rule') continue;
    let match;
    if((match = /^.(?<icon>[\w-]+)-icon:before$/.exec(rule.selectors[0]))) {
      let icon = match.groups.icon;
      let fontFamily = rule.declarations.find(x => ((x.type == 'declaration') && (x.property == 'font-family'))).value;
      let content = rule.declarations.find(x => ((x.type == 'declaration') && (x.property == 'content'))).value.replace(/['"]/g, '');
      let codePoint;
      if(content.startsWith('\\')) codePoint = parseInt(content.slice(1), 16);
      else if(content.length == 1) codePoint = content.charCodeAt(0);
      else dump(`unknown code point: ${content}`)
      rules[icon] = {
        fontFamily,
        codePoint,
        svg: await resolveSVG(icon, fontFamily, codePoint),
        color: await resolveColor(icon),
      };
    }
  }
  return rules;
}

async function resolveSVG(icon, fontFamily, codePoint) {
  switch(fontFamily) {
    case 'Mfizz': return await resolveMFixx(icon, codePoint);
    case 'Devicons': return await resolveDevicons(icon, codePoint);
    case 'file-icons': return await resolveFileIcons(icon, codePoint);
    default:
      return;
      // throw new Error('Unknown font: ' + fontFamily);
  }
}

async function resolveMFixx(icon, codePoint) {
  let source = resolveIcomoon('../modules/MFixx/icomoon.json', codePoint);
  if(source) return { source };
}

async function resolveDevicons(icon, codePoint) {
  let source = resolveIcomoon('../modules/DevOpicons/icomoon.json', codePoint);
  if(source) return { source };
}

async function resolveFileIcons(icon, codePoint) {
  let source = resolveIcomoon('../modules/icons/icomoon.json', codePoint);
  if(source) return { source };
  let name = resolveTsv('../modules/icons/icons.tsv', icon);
  let filename = `../modules/icons/svg/${name}.svg`;
  if(await fs.access(filename)) return { filename };
}

let _icomoonMap = {};
function resolveIcomoon(icomoonFile, code) {
  if(!_icomoonMap[icomoonFile]) {
    _icomoonMap[icomoonFile] = {};
    let icomoon = require(icomoonFile);
    for(let data of icomoon.icons) {
      let { code } = data.properties;
      let { paths } = data.icon;
      let source = `<svg>${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
      _icomoonMap[icomoonFile][code] = source;
    }
  }
  return _icomoonMap[icomoonFile][code];
}

let _tsvMap = {};
async function resolveTsv(tsvFile, icon) {
  if(!_tsvMap[tsvFile]) {
    _tsvMap[tsvFile] = {};
    let tsv = await fs.readFile(tsvFile, 'utf8');
    let icons = TSV.parse(tsv);
    for(let row of icons) {
      let svg = row['SVG file'];
      let name = row['CSS class'];
      if(svg && name) {
        let icon = name.replace('-icon', '');
        _tsvMap[tsvFile][icon] = svg;
      }
    }
  }
  return _tsvMap[tsvFile][icon];
}

let _colorsMap;
async function resolveColor(icon) {
  if(!_colorsMap) {
    _colorsMap = {};
    let config = CSON.load('../modules/atom/config.cson');
    for(let { icon, colour: color, match } of Object.values(config.fileIcons)) {
      if(color) {
        if(Array.isArray(color)) color = color[0];
      }
      if(!color) {
        if(Array.isArray(match)) color = match[0][1];
      }
      if(color && color.startsWith('auto-')) color = color.replace('auto-', 'medium-');
      if(color) _colorsMap[icon] = color;
    }
  }
  return _colorsMap[icon];
}

async function getSupportedIcons() {
  let icons = require('../modules/AFileIcon/icons/icons.json');
  let result = [];
  for(let name in icons) {
    name = name.replace('file_type_', '');
    result.push(name);
  }
  return result;
}
