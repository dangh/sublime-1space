'use strict';

const fs = require('fs');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const log = require('./log');

const DEBUG = process.argv.includes('--debug');

Array.prototype.mapJoin = function (mapFn, joinSep = '') {
  return this.map(mapFn).join(joinSep);
};

const iconId = (s) => `icon-${require('crypto').createHash('md5').update(s).digest('hex')}`;
let sharps = new WeakMap();
const cropToFile = (buffer, box, path) => {
  if(!sharps.has(buffer)) sharps.set(buffer, sharp(buffer));
  return sharps.get(buffer).extract(box).toFile(path);
};

class SVG {
  static async toPNG(tasks) {
    let browser = await puppeteer.launch({ timeout: 0, headless: !DEBUG });
    try {
      let batchSize = 10;
      for(let batchStart = 0; batchStart < tasks.length; batchStart += batchSize) {
        let batch = tasks.slice(batchStart, batchStart + batchSize);
        let offsetGap = 10;
        let offsetTop = 0;
        let offsetLeft = offsetGap;

        let html = `
          <style>
            body {
              font-size: 0;
              line-height: 0;
              margin: 0;
            }
            .input {
              overflow: hidden;  /* avoid input svg touched overlap output region */
            }
            .output {
              margin: 10px;
            }
            ${DEBUG ? `
              .input { background: rgba(0, 0, 255, 0.2); }
              .input svg { fill: black !important; }
              .output { background: rgba(0, 255, 0, 0.2); }
              .output svg { background: rgba(255, 0, 0, 0.2); }
            ` : ''}
          </style>
          <script>
            let options = {};
            let iconIds = [];
          </script>
          ${batch.mapJoin(task => {
            let { name, input, outputs } = task;

            let svg = input.svg.raw;
            if(input.svg.filename) {
              svg = fs.readFileSync(input.svg.filename, 'utf8');
            }

            let { width = 0, height = 0, padding = 0, trim = false } = input;

            let paddings = { left: 0, top: 0, right: 0, bottom: 0 };
            padding = String(padding).split(' ').map(Number);
            switch(padding.length) {
            case 1:
              paddings.left = paddings.top = paddings.right = paddings.bottom = padding[0];
              break;
            case 2:
              paddings.top = paddings.bottom = padding[0];
              padidngs.left = paddings.right = padding[1];
              break;
            case 3:
            case 4:
              paddings.top = padding[0];
              paddings.right = padding[1];
              paddings.bottom = padding[2];
              paddings.left = (padding[3] || 0);
              break;
            }

            let svgWidth = (width - (paddings.left + paddings.right));
            let svgHeight = (height - (paddings.top + paddings.bottom));

            return `
              <div id="${iconId(name)}">
                <h3>${name}</h3>
                <div class="input">
                  ${svg}
                </div>
                ${outputs.mapJoin(output => {
                  let { paths, css, scale = 1 } = output;
                  let id = paths[0];
                  return `
                    <style>
                      #${iconId(name)} .output[data-id="${id}"] ${css || '{}'}
                      #${iconId(name)} .output[data-id="${id}"] {
                        box-sizing: border-box;
                        width: calc(${width}px * ${scale});
                        height: calc(${height}px * ${scale});
                        position: relative;
                      }
                      #${iconId(name)} .output[data-id="${id}"] svg {
                        width: calc(${svgWidth}px * ${scale});
                        height: calc(${svgHeight}px * ${scale});
                        position: absolute;
                        top: calc(${paddings.top}px * ${scale});
                        left: calc(${paddings.left}px * ${scale});
                      }
                    </style>
                    <div class="output" data-id="${id}">
                      ${svg}
                    </div>
                  `;
                })}
                <script>
                  iconIds.push('${iconId(name)}');
                  options['${iconId(name)}'] = {
                    trim: ${!!trim}
                  };
                </script>
              </div>
            `;
          })}
          <script>
            function fit(id) {
              let $input = document.querySelector('#'+id+' .input svg');
              let $outputs = document.querySelectorAll('#'+id+' .output svg');
              let bbox = $input.getBBox();
              let fixedViewBox = [bbox.x, bbox.y, bbox.width, bbox.height].join(' ');
              let fixViewBox = !$input.hasAttribute('viewBox') || options[id].trim;
              $outputs.forEach($output => {
                $output.removeAttribute('width');
                $output.removeAttribute('height');
                if(fixViewBox) $output.setAttribute('viewBox', fixedViewBox);
              });
            }

            iconIds.forEach(fit);

            //hide inputs to get integer bounding rects for output svgs
            let $style = document.querySelector('style');
            $style.sheet.insertRule('.input, h3 { display: none; }');
          </script>
        `;

        fs.writeFileSync('./svg.htm', html);

        let page = await browser.newPage();
        await page.setContent(html);
        let pagePng = (await page.screenshot({ type: 'png', omitBackground: true, fullPage: true }));
        DEBUG && (await fs.writeFileSync(`./page-${batch[0].name}-${batch[batch.length-1].name}.png`, pagePng));
        (await page.close());

        //split icons
        for(let { name, input, outputs } of batch) {
          log.info(name);
          let { width, height } = input;

          for(let { scale, paths } of outputs) {
            offsetTop += offsetGap;

            log.info(' ', paths[0]);
            let box = { top: offsetTop, left: offsetLeft, width: width * scale, height: height * scale };
            (await cropToFile(pagePng, box, paths[0]));

            for(let i = 1; i < paths.length; i++) {
              log.info(' ', paths[i]);
              fs.copyFileSync(paths[0], paths[i]);
            }

            offsetTop += box.height;
          }
        }
      }
    } finally {
      if(!DEBUG) await browser.close();
    }
  }
}

module.exports = SVG;