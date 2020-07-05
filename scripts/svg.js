'use strict';

const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const log = require('./log');

class SVG {
  static async toPNG(tasks) {
    let browser = await puppeteer.launch({ timeout: 0 });
    try {
      let page = await browser.newPage();
      let html = '';

      for(let [name, { input, outputs }] of Object.entries(tasks)) {
        let svg = input.raw;
        if(input.filename) {
          svg = await fs.readFile(input.filename, 'utf8').catch(err => {
            console.error('Failed to read svg file:', err);
            throw err;
          });
        }

        for(let [output, opts] of Object.entries(outputs)) {
          html += this.render(name, svg, output, opts);
        }
      }

      (await fs.writeFile('./svg.htm', `
        <style>
          svg * { fill: black !important; }
          :is([id^=input]) { opacity: 1 !important; }
          :is([id^=input]) svg { background: rgba(0, 0, 255, 0.2); }
          :is([id^=output]) { background: rgba(0, 255, 0, 0.2); }
          :is([id^=output]) svg { background: rgba(255, 0, 0, 0.2); }
        </style>
        ${html}
      `));
      await page.setContent(html);

      //capture png
      for(let [name, { outputs }] of Object.entries(tasks)) {
        console.log('Processing', name);
        for(let [output] of Object.entries(outputs)) {
          let scopeId = this.scopeId(name, output);
          let $output = (await page.$(`#output-${scopeId}`));
          (await $output.screenshot({ path: output, omitBackground: true }));
        }
      }
    } finally {
      await browser.close();
    }
  }

  static scopeId(name, output) {
    return require('crypto').createHash('md5').update(`${name}-${output}`).digest('hex');
  }

  static render(name, svg, output, opts) {
    let { width = 0, height = 0, padding = 0, scale = 1 } = opts;

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

    //scale up all values
    width *= scale;
    height *= scale;
    paddings.top *= scale;
    paddings.right *= scale;
    paddings.bottom *= scale;
    paddings.left *= scale;
    svgWidth *= scale;
    svgHeight *= scale;

    let scopeId = this.scopeId(name, output);

    let html = `
      <h3>${name} - ${output}</h3>
      <style>
        #output-${scopeId} ${opts.css || ''}
        #input-${scopeId} {
          opacity: 0;  //avoid input svg touched overlap output region
        }
        #output-${scopeId} svg {
          width: ${svgWidth}px;
          height: ${svgHeight}px;
          position: absolute;
          top: ${paddings.top}px;
          left: ${paddings.left}px;
        }
      </style>
      <div id='input-${scopeId}'>
        ${svg}
      </div>
      <div id='output-${scopeId}' style='
        box-sizing: border-box;
        width: ${width}px;
        height: ${height}px;
        position: relative;
      '>
        ${svg}
      </div>
      <script>
        (function() {
          let $input = document.querySelector('#input-${scopeId} svg');
          let $output = document.querySelector('#output-${scopeId} svg');
          let bbox = $input.getBBox();
          $output.removeAttribute('width');
          $output.removeAttribute('height');
          if(!$output.hasAttribute('viewBox')) $output.setAttribute('viewBox', \`\${bbox.x} \${bbox.y} \${bbox.width} \${bbox.height}\`);
        })();
      </script>
    `
    return html;
  }
}

module.exports = SVG;