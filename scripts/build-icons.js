'use strict';

const fs = require('fs').promises;
const path = require('path');
const deepmerge = require('deepmerge');
const lessToJs = require('less-vars-to-js');
const CSON = require('cson');
const CSS = require('css');
const LESS = require('less');
const TSV = require('tsv');
const YAML = require('js-yaml');
const SVG = require('./svg');
const log = require('./log');

main().catch(log.error);

async function main() {
  //get all icons supported by A File Icon
  let supportedIcons = await getSupportedIcons();
  // log.debug({ supportedIcons });

  //extract all colors from Atom file-icons package
  let colors = await getColors();
  // log.debug({ colors });

  //extract list of icons from Atom file-icons package
  let icons = await getIcons();
  // log.debug({ icons });

  //build inject css map
  let injectCss = {};
  for(let color in colors) {
    injectCss[color] = `svg * { fill: ${colors[color]}; }`;
  }
  // log.debug({ injectCss });

  let iconsToGenerate = process.argv.slice(2);
  if(iconsToGenerate.length == 0) iconsToGenerate = supportedIcons;

  //generate pngs
  let tasks = {};
  let iconSize = (await getIconSize());
  for(let icon of iconsToGenerate) {
    if(!(icon in icons)) {
      log.error(icon, '[no icon]');
      continue;
    }

    let { svg, color, dark, light } = icons[icon];
    if(!svg) {
      log.warn(icon, '[no svg]');
      continue;
    }
    let darkColor = dark?.color ?? color.replace('auto-', 'medium-');
    let lightColor = light?.color ?? color.replace('auto-', 'dark-');

    log.info(icon, '[ok]');

    tasks[icon] = {
      input: svg,
      outputs: {
        [`../dark/icons/file_type_${icon}.png`]: { width: iconSize, height: iconSize, css: injectCss[darkColor], scale: 1 },
        [`../dark/icons/file_type_${icon}@2x.png`]: { width: iconSize, height: iconSize, css: injectCss[darkColor], scale: 2 },
        [`../dark/icons/file_type_${icon}@3x.png`]: { width: iconSize, height: iconSize, css: injectCss[darkColor], scale: 3 },
        [`../light/icons/file_type_${icon}.png`]: { width: iconSize, height: iconSize, css: injectCss[lightColor], scale: 1 },
        [`../light/icons/file_type_${icon}@2x.png`]: { width: iconSize, height: iconSize, css: injectCss[lightColor], scale: 2 },
        [`../light/icons/file_type_${icon}@3x.png`]: { width: iconSize, height: iconSize, css: injectCss[lightColor], scale: 3 },
      }
    };
    }
  log.debug({ tasks });
  await SVG.toPNG(tasks);
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
  let rules = (await parseLess(less));
  let colors = {};
  for(let [selector, properties] of Object.entries(rules)) {
    let color = selector.replace(/^\./, '');
    let value = properties['color'];
    colors[color] = value;
  }
  return colors;
}

async function getIcons() {
  // get icons from atom's file-icons package
  let rules = (await loadLess('../modules/atom/styles/icons.less'));
  let icons = {};
  for(let [selector, properties] of Object.entries(rules)) {
    let match;
    if((match = /^.(?<name>[\w-]+)-icon:before$/.exec(selector))) {
      let name = match.groups.name;
      let fontFamily = properties['font-family'];
      let content = properties['content'].replace(/['"]/g, '');
      let codePoint;
      if(content.startsWith('\\')) codePoint = parseInt(content.slice(1), 16);
      else if(content.length == 1) codePoint = content.charCodeAt(0);
      else log.warn(`unknown code point: ${content}`)
      icons[name] = {
        fontFamily,
        codePoint,
        svg: (await resolveSVG(name, fontFamily, codePoint)),
        color: (await resolveColor(name)),
      };
    }
  }
  // get override icons
  let overrides = (await loadYaml('./icons.yml'));
  for(let [name, override] of Object.entries(overrides)) {
    if(!override) continue;
    let { alias, ...config } = override;
    if(alias) {
      if(!icons[name]) icons[name] = deepmerge(icons[alias], config);
      else icons[name] = deepmerge(icons[name], { svg: icons[alias].svg }, config);
    } else {
      icons[name] = deepmerge(icons[name], config);
    }
  }
  return icons;
}

async function resolveSVG(name, fontFamily, codePoint) {
  switch(fontFamily) {
    case 'Mfizz': return (await resolveMFixx(name, codePoint));
    case 'Devicons': return (await resolveDevicons(name, codePoint));
    case 'file-icons': return (await resolveFileIcons(name, codePoint));
    case '"Octicons Regular"': return (await resolveOctoicons(name, codePoint));
    case 'FontAwesome': return (await resolveFontAwesome(name, codePoint));
    default:
      return;
      // throw new Error('Unknown font: ' + fontFamily);
  }
}

async function resolveMFixx(name, codePoint) {
  let raw = resolveIcomoon('../modules/MFixx/icomoon.json', codePoint);
  if(raw) return { raw };
}

async function resolveDevicons(name, codePoint) {
  let raw = resolveIcomoon('../modules/DevOpicons/icomoon.json', codePoint);
  if(raw) return { raw };
}

async function resolveOctoicons(name, codePoint) {
  for(let filename of [
    `../modules/octoicons/icons/${name}-24.svg`,
    `../modules/octoicons/icons/file-${name}-24.svg`,
    `../modules/octoicons/icons/${name}-16.svg`,
    `../modules/octoicons/icons/file-${name}-16.svg`,
  ]) {
    if((await fs.access(filename).then(() => true, () => false))) return { filename };
  }
}

let _fontAwesome;
let _fontAwesomeSearch;
async function resolveFontAwesome(name, codePoint) {
  if(!_fontAwesome) {
    _fontAwesome = {};
    _fontAwesomeSearch = {};
    let icons = require('../modules/Font-Awesome/metadata/icons.json');
    for(let [name, metadata] of Object.entries(icons)) {
      _fontAwesome[name] = (metadata.svg.regular || metadata.svg.solid || metadata.svg.brands).raw;
      for(let [index, term] of metadata.search.terms.entries()) {
        if(!_fontAwesomeSearch[term]) _fontAwesomeSearch[term] = [];
        if(!_fontAwesomeSearch[term][index]) _fontAwesomeSearch[term][index] = name;
      }
    }
  }
  let raw = _fontAwesome[name];
  if(!raw) {
    let aliases = _fontAwesomeSearch[name];
    if(aliases) raw = _fontAwesome[aliases[0]];
  }
  if(raw) return { raw };
}

async function resolveFileIcons(name, codePoint) {
  let raw = resolveIcomoon('../modules/icons/icomoon.json', codePoint);
  if(raw) return { raw };
  let icon = resolveTsv('../modules/icons/icons.tsv', name);
  let filename = `../modules/icons/svg/${icon}.svg`;
  if((await fs.access(filename).then(() => true, () => false))) return { filename };
}

let _icomoonMap = {};
function resolveIcomoon(icomoonFile, code) {
  if(!_icomoonMap[icomoonFile]) {
    _icomoonMap[icomoonFile] = {};
    let icomoon = require(icomoonFile);
    for(let data of icomoon.icons) {
      let { code } = data.properties;
      let { paths } = data.icon;
      let raw = `<svg>${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
      _icomoonMap[icomoonFile][code] = raw;
    }
  }
  return _icomoonMap[icomoonFile][code];
}

let _tsvMap = {};
async function resolveTsv(tsvFile, icon) {
  if(!_tsvMap[tsvFile]) {
    _tsvMap[tsvFile] = {};
    let tsv = (await loadTsv(tsvFile));
    for(let row of tsv) {
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
async function resolveColor(name) {
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
      if(color) _colorsMap[icon] = color;
    }
  }
  return _colorsMap[name];
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

async function getIconSize() {
  let theme = (await fs.readFile('../1Space.hidden-theme', 'utf8'));
  eval(`theme = ${theme}`);  // sublime-theme is not valid JSON, but an JS object
  let contentMargin = theme.variables['--icon_file_type.content_margin'];
  return (contentMargin * 2);
}

async function parseYaml(yaml) {
  let json = (await YAML.load(yaml));
  return json;
}

async function loadYaml(file) {
  let yaml = (await fs.readFile(file, 'utf8'));
  return (await parseYaml(yaml));
}

async function parseLess(less) {
  let result = (await LESS.render(less));
  return (await parseCss(result.css));
}

async function loadLess(file) {
  let less = (await fs.readFile(file, 'utf8'));
  return (await parseLess(less));
}

async function parseCss(css) {
  let ast = await CSS.parse(css);
  let rules = {};
  for(let rule of ast.stylesheet.rules) {
    if(rule.type != 'rule') continue;
    let selector = rule.selectors.join(',');
    if(!rules[selector]) rules[selector] = {};
    for(let declaration of rule.declarations) {
      if(declaration.type != 'declaration') continue;
      rules[selector][declaration.property] = declaration.value;
    }
  }
  return rules;
}

async function loadTsv(file) {
  let tsv = (await fs.readFile(file, 'utf8'));
  return TSV.parse(tsv);
}