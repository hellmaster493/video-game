/*
 * build.js — inline the whole game into one HTML file.
 *
 *   node build.js            → dist/playtime-factory.html   (standalone page)
 *   node build.js --fragment → dist/fragment.html           (no <html>/<head>/<body>,
 *                                                            for hosts that supply them)
 *
 * The game has no dependencies, so "bundling" is just substitution: read
 * index.html, swap each <link>/<script src> for the file it points at.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const fragment = process.argv.includes('--fragment');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">/g,
  (_, href) => '<style>\n' + read(href).trim() + '\n</style>');

html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>/g,
  (_, src) => '<script>\n' + read(src).trim() + '\n</script>');

if (fragment) {
  // keep only what lives inside <body>, plus the <title> and <style> from <head>
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  html = title + '\n' + style + '\n' + body.trim() + '\n';
}

const out = path.join(root, 'dist', fragment ? 'fragment.html' : 'playtime-factory.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out, '·', (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
