// Copies ceki.png + ceki-{light,dark}.svg next to every node
// → into the matching dist/nodes/... folder for n8n to find by file:...
const fs = require('fs');
const path = require('path');

const ICONS = ['ceki.png', 'ceki-light.svg', 'ceki-dark.svg'];
const SRC = 'nodes/BrowserCeki';

for (const name of ICONS) {
	const src = path.join(SRC, name);
	if (!fs.existsSync(src)) {
		console.error('icon not found:', src);
		process.exit(0);
	}
}

function walk(dir) {
	let out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const p = path.join(dir, entry.name);
			out.push(p);
			out = out.concat(walk(p));
		}
	}
	return out;
}

for (const name of ICONS) {
	const data = fs.readFileSync(path.join(SRC, name));
	const dirs = walk('dist/nodes');
	for (const d of dirs) {
		fs.writeFileSync(path.join(d, name), data);
	}
	console.log(`copied ${name} to ${dirs.length} node dirs`);
}
