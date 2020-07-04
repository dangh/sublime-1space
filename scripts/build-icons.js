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
const log = require('./log');

main().catch(log.error);

async function main() {
  //get all icons supported by A File Icon
  let supportedIcons = await getSupportedIcons();
  log.debug({ supportedIcons });

  //extract all colors from Atom file-icons package
  let colors = await getColors();
  log.debug({ colors });

  //extract list of icons from Atom file-icons package
  let icons = await getIcons();
  log.debug({ icons });

  //build inject css map
  let injectCss = {};
  for(let color in colors) {
    injectCss[color] = `svg * { fill: ${colors[color]}; }`;
  }
  log.debug({ injectCss });

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

    let { svg, color } = icons[icon];
    if(!svg) {
      log.warn(icon, '[no svg]');
      continue;
    }

    log.info(icon, '[ok]');
    let input = svg;
    if(input.filename) input.filename = path.resolve(input.filename);
    tasks[icon] = {
      input: svg,
      outputs: {
        [path.resolve('../icons/file_type_' + icon + '.png')]: { width: iconSize, height: iconSize, css: injectCss[color] },
        [path.resolve('../icons/file_type_' + icon + '@2x.png')]: { width: (iconSize * 2), height: (iconSize * 2), css: injectCss[color] },
        [path.resolve('../icons/file_type_' + icon + '@3x.png')]: { width: (iconSize * 3), height: (iconSize * 3), css: injectCss[color] },
      }
    }
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
    if((match = /^.(?<icon>[\w-]+)-icon:before$/.exec(selector))) {
      let icon = match.groups.icon;
      let fontFamily = properties['font-family'];
      let content = properties['content'].replace(/['"]/g, '');
      let codePoint;
      if(content.startsWith('\\')) codePoint = parseInt(content.slice(1), 16);
      else if(content.length == 1) codePoint = content.charCodeAt(0);
      else log.warn(`unknown code point: ${content}`)
      icons[icon] = {
        fontFamily,
        codePoint,
        svg: (await resolveSVG(icon, fontFamily, codePoint)),
        color: (await resolveColor(icon)),
      };
    }
  }
  // get override icons
  let overrides = (await loadYaml('./icons.yml'));
  for(let [icon, override] of Object.entries(overrides)) {
    if(!override) continue;
    let { alias, ...config } = override;
    if(alias) {
      if(!icons[icon]) icons[icon] = Object.assign({}, icons[alias], config);
      else Object.assign(icons[icon], { svg: icons[alias].svg }, config);
    } else icons[icon] = Object.assign({}, icons[icon], config);
  }
  return icons;
}

async function resolveSVG(icon, fontFamily, codePoint) {
  switch(fontFamily) {
    case 'Mfizz': return (await resolveMFixx(icon, codePoint));
    case 'Devicons': return (await resolveDevicons(icon, codePoint));
    case 'file-icons': return (await resolveFileIcons(icon, codePoint));
    case '"Octicons Regular"': return (await resolveOctoicons(icon, codePoint));
    case 'FontAwesome': return (await resolveFontAwesome(icon, codePoint));
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

async function resolveOctoicons(icon, codePoint) {
  for(let filename of [
    `../modules/octoicons/icons/${icon}-24.svg`,
    `../modules/octoicons/icons/file-${icon}-24.svg`,
    `../modules/octoicons/icons/${icon}-16.svg`,
    `../modules/octoicons/icons/file-${icon}-16.svg`,
  ]) {
    if((await fs.access(filename).then(() => true, () => false))) return { filename };
  }
}

let _fontAwesome;
let _fontAwesomeSearch;
async function resolveFontAwesome(icon, codePoint) {
  if(!_fontAwesome) {
    _fontAwesome = {};
    _fontAwesomeSearch = {};
    let icons = require('../modules/Font-Awesome/metadata/icons.json');
    for(let [icon, metadata] of Object.entries(icons)) {
      _fontAwesome[icon] = (metadata.svg.regular || metadata.svg.solid || metadata.svg.brands).raw;
      for(let [index, term] of metadata.search.terms.entries()) {
        if(!_fontAwesomeSearch[term]) _fontAwesomeSearch[term] = [];
        if(!_fontAwesomeSearch[term][index]) _fontAwesomeSearch[term][index] = icon;
      }
    }
  }
  let source = _fontAwesome[icon];
  if(!source) {
    let aliases = _fontAwesomeSearch[icon];
    if(aliases) source = _fontAwesome[aliases[0]];
  }
  if(source) return { source };
}

async function resolveFileIcons(icon, codePoint) {
  let source = resolveIcomoon('../modules/icons/icomoon.json', codePoint);
  if(source) return { source };
  let name = resolveTsv('../modules/icons/icons.tsv', icon);
  let filename = `../modules/icons/svg/${name}.svg`;
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