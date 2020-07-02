'use strict';

const fs = require('fs').promises;
const puppeteer = require('puppeteer');

class SVG {
  static async toPNG(jobs) {
    let browser = await puppeteer.launch();
    try {
      let page = await browser.newPage();

      for(let [icon, { input, outputs }] of Object.entries(jobs)) {
        console.log('Processing', icon);

        let svg = input.source;
        if(input.filename) {
          svg = await fs.readFile(input.filename, 'utf8').catch(err => {
            console.error('Failed to read svg file:', err);
            throw err;
          });
        }

        for(let [output, opts] of Object.entries(outputs)) {
          let html = `
            <style>
              ${opts.css || ''}
            </style>
            ${svg}
          `

          await page.setContent(html);

          //resize svg
          await page.evaluate((width, height) => {
            let $svg = document.querySelector('svg');
            let bbox = $svg.getBBox();
            $svg.removeAttribute('width');
            $svg.removeAttribute('height');
            $svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
            $svg.setAttribute('style', `width:${width}px;height:${height}px;`);
          }, opts.width, opts.height);

          //capture png
          let $svg = await page.$('svg');
          await $svg.screenshot({ path: output, omitBackground: true });
        }
      }
    } finally {
      await browser.close();
    }
  }
}

module.exports = SVG;