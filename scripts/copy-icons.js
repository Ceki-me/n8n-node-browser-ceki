// Copies SVG icons next to every node → into the matching dist/nodes/... folder.
const fs = require('fs');
const path = require('path');

const LIGHT_SRC = path.join('nodes', 'BrowserCeki', 'ceki-light.svg');
const DARK_SRC = path.join('nodes', 'BrowserCeki', 'ceki-dark.svg');

if (!fs.existsSync(LIGHT_SRC) || !fs.existsSync(DARK_SRC)) {
	console.error('icon source(s) not found');
	process.exit(0);
}

const lightSvg = fs.readFileSync(LIGHT_SRC);
const darkSvg = fs.readFileSync(DARK_SRC);

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

let n = 0;
for (const d of walk('dist/nodes')) {
	fs.writeFileSync(path.join(d, 'ceki-light.svg'), lightSvg);
	fs.writeFileSync(path.join(d, 'ceki-dark.svg'), darkSvg);
	n++;
}
console.log(`copied SVG icons to ${n} node dirs`);
