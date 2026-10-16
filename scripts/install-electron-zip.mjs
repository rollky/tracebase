// Optional offline installer. Verify against checksums shipped in the Electron npm package.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const file=process.argv[2],artifact=process.argv[3];
if(!file||!artifact)throw new Error('Usage: node scripts/install-electron-zip.mjs /path/to/download.zip electron-vVERSION-darwin-x64.zip');
const checksums=require('electron/checksums.json');
if(!checksums[artifact])throw new Error('Artifact is not present in the official package checksum list');
const buffer=await fs.readFile(file),actual=createHash('sha256').update(buffer).digest('hex');
if(actual!==checksums[artifact])throw new Error('SHA256 mismatch: refusing to extract');
const packageRoot=path.dirname(require.resolve('electron/package.json'));
const {extract}=require('@electron-internal/extract-zip');
await extract(path.resolve(file),{dir:path.join(packageRoot,'dist')});
const target=process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron';
await fs.writeFile(path.join(packageRoot,'path.txt'),target);
console.log('Electron runtime installed; official SHA256 verified.');
