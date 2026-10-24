import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {deploymentSpec} from './delivery/base/spec.mjs';
const root = process.cwd();
const config = JSON.parse(await readFile(resolve(root, 'packaging.json'), 'utf8'));
const expected = JSON.stringify(await deploymentSpec(root, config.artifact.specInputs), null, 2) + '\n';
const output = resolve(root, 'management/integration/deployment-spec.json');
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== expected) throw Error('Deployment specification is stale; run pnpm delivery:spec after the real build.');
  console.log('Deployment specification matches the real build and source policy.');
} else {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, expected);
  console.log('Deployment specification written.');
}
