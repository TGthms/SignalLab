import { build } from 'esbuild';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

await build({ entryPoints: ['ui/navigation.jsx'], outfile: 'dist/ui-navigation.mjs', bundle: true, minify: true, format: 'esm', target: ['es2022'], legalComments: 'linked', define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('node_modules/@heroui/styles/dist/heroui.min.css', 'dist/heroui.min.css');
const icons = ['north_east', 'south_west', 'light_mode', 'dark_mode', 'mic', 'download', 'upload'];
const symbols = await Promise.all(icons.map(async name => {
  const svg = await readFile(`node_modules/@material-symbols/svg-400/outlined/${name}.svg`, 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
  const content = svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '');
  return `<symbol id="${name}" viewBox="${viewBox}">${content}</symbol>`;
}));
await writeFile('dist/material-symbols.svg', `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`);
