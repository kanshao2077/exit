import { spawnSync } from 'node:child_process';
const commands=[['node_modules/eslint/bin/eslint.js','.'],['node_modules/typescript/bin/tsc','-b'],['node_modules/vitest/vitest.mjs','run'],['node_modules/vite/bin/vite.js','build'],['scripts/personalization.mjs','--build'],['scripts/licenses.mjs'],['scripts/e2e.mjs']];
for(const args of commands){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
