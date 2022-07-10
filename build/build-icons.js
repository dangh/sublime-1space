'use strict';

const fs = require('fs');
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
const { sourceDir, rootDir, buildDir } = require('./path');

const DEBUG = process.argv.includes('--debug');
const IGNORE_EXISTING = process.argv.includes('--ignore-existing');

main().catch(log.error);

async function main() {
  //get all icons supported by A File Icon
  let supportedIcons = await getSupportedIcons();
  DEBUG && fs.writeFileSync(buildDir('icons-supported.json'), JSON.stringify(supportedIcons, null, 2));

  //extract all colors from Atom file-icons package
  let colors = await getColors();
  DEBUG && fs.writeFileSync(buildDir('colors.json'), JSON.stringify(colors, null, 2));

  //extract list of icons from Atom file-icons package
  let icons = await getIcons();
  DEBUG && fs.writeFileSync(buildDir('icons.json'), JSON.stringify(icons, null, 2));

  let iconsToGenerate = process.argv.slice(2).filter(name => !name.startsWith('-'));
  if(iconsToGenerate.length == 0) iconsToGenerate = Object.keys(icons);

  await generatePreferences(icons, supportedIcons);

  //generate pngs
  let tasks = [];
  let iconSize = (await getIconSize());
  for(let icon of iconsToGenerate) {
    if(!(icon in icons)) {
      log.error(icon, '[no icon]');
      continue;
    }

    let { svg, color, dark, light, trim } = icons[icon];
    if(!svg) {
      log.warn(icon, '[no svg]');
      continue;
    }

    if(!color && !dark && !light) {
      log.warn(icon, '[no color]');
      continue;
    }

    let darkColor = dark?.color ?? color.replace('auto-', 'medium-');
    let lightColor = light?.color ?? color.replace('auto-', 'dark-');

    darkColor = colors[darkColor] ?? darkColor;
    lightColor = colors[lightColor] ?? lightColor;

    log.info(icon, '[ok]');

    let outputs;
    if(darkColor == lightColor) {
      outputs = [
        { scale: 6, css: `svg * { fill: ${darkColor} }`, paths: [rootDir(`theme-dark/icons/file_type_${icon}.png`), rootDir(`theme-light/icons/file_type_${icon}.png`)] },
      ];
    } else {
      outputs = [
        { scale: 6, css: `svg * { fill: ${darkColor} }`, paths: [rootDir(`theme-dark/icons/file_type_${icon}.png`)] },
        { scale: 6, css: `svg * { fill: ${lightColor} }`, paths: [rootDir(`theme-light/icons/file_type_${icon}.png`)] },
      ];
    }

    if(IGNORE_EXISTING) {
      outputs.forEach(output => {
        output.paths = output.paths.filter(path => !fs.existsSync(path));
      });
      outputs = outputs.filter(output => {
        return output.paths.length > 0;
      });
      if(!outputs.length) {
        log.info(icon, '[no outputs]');
        continue;
      }
    }

    tasks.push({
      name: icon,
      input: {
        svg,
        width: iconSize,
        height: iconSize,
        trim,
      },
      outputs
    });
  }
  DEBUG && fs.writeFileSync(buildDir('tasks.json'), JSON.stringify(tasks, null, 2));
  await SVG.toPNG(tasks);
}

async function getColors() {
  let less = fs.readFileSync(sourceDir('atom/styles/colours.less'), 'utf8');
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
  let icons = {};

  //get icons from atom's file-icons package
  let rules = (await loadLess(sourceDir('atom/styles/icons.less')));
  let colors = (await resolveColors());
  for(let [selector, properties] of Object.entries(rules)) {
    let match;
    if((match = /^.(?<name>[\w-]+)-icon:before$/.exec(selector))) {
      let name = match.groups.name;
      let fontFamily = properties['font-family'];
      let content = properties['content'].replace(/['"]/g, '');
      let codePoint;
      if(content.startsWith('\\')) codePoint = parseInt(content.slice(1), 16);
      else if(content.length == 1) codePoint = content.charCodeAt(0);
      else log.warn(`unknown code point: ${content}`);
      if(colors[name]) {
        let svg = (await resolveSVG(name, fontFamily, codePoint));
        for(let { color, fileType } of Object.values(colors[name])) {
          icons[fileType] = {
            fontFamily,
            codePoint,
            svg,
            color,
          };
        }
      }
    }
  }
  //get override icons
  let overrides = (await loadYaml(buildDir('icons.yml')));
  DEBUG && fs.writeFileSync(buildDir('icons-override.json'), JSON.stringify(overrides, null, 2));
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
  //make filename absolute
  for(let { svg } of Object.values(icons)) {
    if(svg?.filename) {
      svg.filename = buildDir(svg.filename);
    }
  }
  //sort icon map
  let iconNames = Object.keys(icons);
  iconNames.sort();
  icons = iconNames.reduce((map, name) => { map[name] = icons[name]; return map; }, {});
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
      //throw new Error('Unknown font: ' + fontFamily);
  }
}

async function resolveMFixx(name, codePoint) {
  return resolveIcomoon(sourceDir('MFixx/icomoon.json'), codePoint);
}

async function resolveDevicons(name, codePoint) {
  return resolveIcomoon(sourceDir('DevOpicons/icomoon.json'), codePoint);
}

async function resolveOctoicons(name, codePoint) {
  for(let filename of [
    sourceDir(`octoicons/icons/file-${name}-24.svg`),
    sourceDir(`octoicons/icons/${name}-24.svg`),
    sourceDir(`octoicons/icons/file-${name}-16.svg`),
    sourceDir(`octoicons/icons/${name}-16.svg`),
  ]) {
    if(fs.existsSync(filename)) return { filename };
  }
}

let _fontAwesome;
async function resolveFontAwesome(name, codePoint) {
  if(!_fontAwesome) {
    _fontAwesome = {};
    let icons = require(sourceDir('Font-Awesome/metadata/icons.json'));
    for(let [name, metadata] of Object.entries(icons)) {
      let code = parseInt(metadata.unicode, 16);
      let filename = path.join(buildDir('src/Font-Awesome/svgs'), Object.keys(metadata.svg)[0], name + '.svg');
      _fontAwesome[code] = { filename };
    }
  }
  return _fontAwesome[codePoint];
}

async function resolveFileIcons(name, codePoint) {
  return resolveTsv(sourceDir('icons/icons.tsv'), codePoint);
}

let _icomoonMap = {};
function resolveIcomoon(icomoonFile, codePoint) {
  if(!_icomoonMap[icomoonFile]) {
    _icomoonMap[icomoonFile] = {};
    let icomoon = require(icomoonFile);
    for(let data of icomoon.icons) {
      let { code, name } = data.properties;
      let { tags } = data.icon;
      let filenames = tags.map(tag => path.join(icomoonFile, '../svg', tag + '.svg'));
      let filename = filenames.find(filename => fs.existsSync(filename));
      if(filename) {
        _icomoonMap[icomoonFile][code] = { filename };
      } else {
        let { paths, width = 1024 } = data.icon;
        let raw = `<svg width="${width}px" height="${width}px">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
        _icomoonMap[icomoonFile][code] = { raw };
      }
    }
  }
  return _icomoonMap[icomoonFile][codePoint];
}

let _tsvMap = {};
async function resolveTsv(tsvFile, codePoint) {
  if(!_tsvMap[tsvFile]) {
    _tsvMap[tsvFile] = {};
    let tsv = (await loadTsv(tsvFile));
    DEBUG && fs.writeFileSync(buildDir('tsv.json'), JSON.stringify(tsv, null, 2));
    for(let row of tsv) {
      let code = parseInt(row['# Codepoint'].slice(2), 16);
      let svg = decodeURIComponent(row['SVG file']);
      if(code && svg) {
        let filename = path.join(tsvFile, '../svg', svg);
        _tsvMap[tsvFile][code] = { filename };
      }
    }
  }
  return _tsvMap[tsvFile][codePoint];
}

function resolveColors() {
  let colors = {};
  let config = CSON.load(sourceDir('atom/config.cson'));
  for(let [name, { icon, colour: color, match }] of Object.entries(config.fileIcons)) {
    if(color) {
      if(Array.isArray(color)) color = color[0];
    }
    if(!color) {
      if(Array.isArray(match)) {
        let m;
        //prefer color of the matched extension
        if((m = match.find(m => m[0] == `.${icon}`))) color = m[1];
        //else fallback to the first match that has color
        else if((m = match.find(m => m[1]))) color = m[1];
      }
    }
    let fileType;
    if(/^[\w-]$/.test(name)) fileType = name.toLowerCase();
    else fileType = icon;
    if(!colors[icon]) colors[icon] = [];
    colors[icon].push({ color, fileType });
  }
  return colors;
}

async function getSupportedIcons() {
  let icons = require(sourceDir('AFileIcon/icons/icons.json'));
  let result = [];
  for(let name in icons) {
    name = name.replace('file_type_', '');
    result.push(name);
  }
  return result;
}

async function getIconSize() {
  return 16;
  let theme = fs.readFileSync(rootDir('1Space.hidden-theme'), 'utf8');
  eval(`theme = ${theme}`);  //sublime-theme is not valid JSON, but an JS object
  let contentMargin = theme.variables['--icon_file_type.content_margin'];
  return (contentMargin * 2);
}

async function parseYaml(yaml) {
  let json = (await YAML.load(yaml));
  return json;
}

async function loadYaml(file) {
  let yaml = fs.readFileSync(file, 'utf8');
  return (await parseYaml(yaml));
}

async function parseLess(less) {
  let result = (await LESS.render(less));
  return (await parseCss(result.css));
}

async function loadLess(file) {
  let less = fs.readFileSync(file, 'utf8');
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
  let tsv = fs.readFileSync(file, 'utf8');
  return TSV.parse(tsv);
}

async function generatePreferences(icons, supportedIcons) {
  for(let [name, icon] of Object.entries(icons)) {
    if(supportedIcons.includes(name)) continue;

    let scope = icon.scope;
    if(!scope) scope = [`source.${name}`];
    scope = scope.join(', ');

    fs.writeFileSync(rootDir(`preferences/file_type_${name}.tmPreferences`),
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>scope</key>
    <string>${scope}</string>
    <key>settings</key>
    <dict>
      <key>icon</key>
      <string>file_type_${name}</string>
    </dict>
  </dict>
</plist>
`);
  }
}
