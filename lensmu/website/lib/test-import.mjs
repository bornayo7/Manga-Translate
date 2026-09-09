// Compile the actual production TypeScript graph in memory using the project's
// existing compiler. Tests exercise public functions without a second runtime
// implementation or generated files in the source tree (works on CI Node 20).
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const cache = new Map();
async function compiledUrl(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    const source = await readFile(path, 'utf8');
    let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)];
    for (const match of imports) {
      if (!match[1].startsWith('.')) continue;
      let dependency = resolve(dirname(path), match[1]);
      if (!extname(dependency)) dependency += '.ts';
      const url = dependency.endsWith('.ts') ? await compiledUrl(dependency) : pathToFileURL(dependency).href;
      code = code.replace(match[0], `from ${JSON.stringify(url)}`);
    }
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  })();
  cache.set(path, promise);
  return promise;
}
export async function importProduction(name) {
  return import(await compiledUrl(resolve(dirname(fileURLToPath(import.meta.url)), name)));
}
