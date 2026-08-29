import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TileService, parseTileCoordinates } from '../src/tile-service.js';

const [, , zValue = '8', xValue = '134', yValue = '90', outputName = 'tile.png'] = process.argv;
const coords = parseTileCoordinates(zValue, xValue, yValue);
if (!coords) throw new Error('Usage: render-demo.js <z> <x> <y> [output.png]');

const outputDir = path.resolve('out');
const service = new TileService({ cacheDir: path.resolve('.cache/tiles') });
const result = await service.getTile(coords);
await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, path.basename(outputName));
await writeFile(outputPath, result.png);
console.log(`${outputPath} (${result.png.length} bytes, cache ${result.cache})`);
