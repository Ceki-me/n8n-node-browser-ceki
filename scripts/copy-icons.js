// Копирует ceki.svg рядом с каждой нодой → в соответствующую папку dist/nodes/...
// tsc копирует только .ts; иконки (file:ceki.svg) n8n ищет рядом со скомпилированным .js.
const fs = require('fs');
const path = require('path');

const ICON_SRC = path.join('nodes', 'BrowserCeki', 'ceki.png');
if (!fs.existsSync(ICON_SRC)) {
	console.error('icon source not found:', ICON_SRC);
	process.exit(0);
}
const svg = fs.readFileSync(ICON_SRC);

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
	fs.writeFileSync(path.join(d, 'ceki.png'), svg);
	n++;
}
console.log(`copied ceki.svg to ${n} node dirs`);
