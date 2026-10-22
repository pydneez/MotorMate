// Used by backend/Dockerfile. Removes packages that a `pnpm deploy --prod` folder only
// contains because pnpm linked *optional* peer dependencies — here the Prisma CLI and
// TypeScript, optional peers of @prisma/client that the API never loads (~200 MB with
// their own dependencies). Walks the real dependency tree from the backend's production
// dependencies, skipping just those peer links, and deletes every package in
// node_modules/.pnpm that isn't reached.
//
//   node prune-optional-peers.cjs <deploy dir> <peer name>...
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const [root, ...droppedPeers] = process.argv.slice(2);
if (!root || droppedPeers.length === 0) {
  console.error("usage: node prune-optional-peers.cjs <deploy dir> <peer name>...");
  process.exit(2);
}
const rootModules = path.join(root, "node_modules");
const store = path.join(rootModules, ".pnpm");
const skip = new Set(droppedPeers);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const exists = (p) => fs.existsSync(p);

/** The `.pnpm/<entry>` folder a package lives in, or null for packages outside the store. */
function storeEntry(pkgDir) {
  const rel = path.relative(store, pkgDir);
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep)[0];
}

/**
 * Where `dep` resolves from `pkgDir`, using Node's own lookup (walk up, checking each
 * `node_modules`). In the pnpm layout that finds a package's dependencies as its siblings
 * in `.pnpm/<entry>/node_modules`.
 */
function resolveDep(pkgDir, dep) {
  for (let dir = pkgDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", dep);
    if (exists(candidate)) return fs.realpathSync(candidate);
    if (dir === root || dir === path.dirname(dir)) return null;
  }
}

const keptEntries = new Set();
const seen = new Set();
function visit(pkgDir) {
  if (seen.has(pkgDir)) return;
  seen.add(pkgDir);
  const entry = storeEntry(pkgDir);
  if (entry) keptEntries.add(entry);
  const pkg = readJson(path.join(pkgDir, "package.json"));
  const optionalPeers = new Set(
    Object.entries(pkg.peerDependenciesMeta ?? {}).filter(([, m]) => m.optional).map(([n]) => n),
  );
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}).filter((n) => !(optionalPeers.has(n) && skip.has(n))),
  ];
  for (const dep of deps) {
    const target = resolveDep(pkgDir, dep);
    if (target) visit(target);
  }
}

// Start from the backend's own production dependencies (the top level of node_modules).
const rootPkg = readJson(path.join(root, "package.json"));
for (const dep of Object.keys(rootPkg.dependencies ?? {})) {
  const target = path.join(rootModules, dep);
  if (!exists(target)) throw new Error(`missing production dependency ${dep}`);
  visit(fs.realpathSync(target));
}

let removed = 0;
for (const entry of fs.readdirSync(store)) {
  if (entry.startsWith(".") || entry === "node_modules" || keptEntries.has(entry)) continue;
  fs.rmSync(path.join(store, entry), { recursive: true, force: true });
  removed++;
}
// Links left pointing at removed packages: the dropped peers next to kept packages, and
// pnpm's hoisted links in .pnpm/node_modules.
function removeDanglingLinks(dir) {
  if (!exists(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const link = path.join(dir, name);
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink()) {
      if (!exists(link)) fs.unlinkSync(link);
    } else if (name.startsWith("@") && stat.isDirectory()) {
      removeDanglingLinks(link);
    }
  }
}
removeDanglingLinks(path.join(store, "node_modules"));
for (const entry of keptEntries) removeDanglingLinks(path.join(store, entry, "node_modules"));
console.log(`pruned ${removed} packages reachable only through optional peers: ${droppedPeers.join(", ")}`);
