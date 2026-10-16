import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const svg=await fs.readFile('build/icon.svg','utf8');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
  await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
  const large=await page.screenshot({omitBackground:true,path:'build/icon.png'});
  await page.setViewportSize({width:256,height:256});const small=await page.screenshot({omitBackground:true});
  const icns=Buffer.alloc(16);icns.write('icns');icns.writeUInt32BE(large.length+16,4);icns.write('ic10',8);icns.writeUInt32BE(large.length+8,12);await fs.writeFile('build/icon.icns',Buffer.concat([icns,large]));
  const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(small.length,14);ico.writeUInt32LE(22,18);await fs.writeFile('build/icon.ico',Buffer.concat([ico,small]));
  console.log('Created macOS and Windows application icons.');
}finally{await browser.close();}
