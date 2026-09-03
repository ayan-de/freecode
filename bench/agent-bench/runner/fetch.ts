#!/usr/bin/env tsx
// Refresh the local instance cache from SWE-bench Lite. Network, one-time.
//   tsx bench/agent-bench/runner/fetch.ts [repo]

import { readCache, refreshCache } from "./instances.js";

const repo = process.argv[2] ?? "django/django";
const n = await refreshCache(repo);
const cache = readCache();
console.log(`cached ${n} instances from ${repo}`);
for (const id of [...cache.keys()].sort().slice(0, 5)) console.log(`  ${id}`);
console.log(`  … ${cache.size} total`);
