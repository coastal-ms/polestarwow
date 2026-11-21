'use strict';

// Stage a side-by-side build for testing in the Forever client.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const root = path.join(__dirname, '..');
const prefix = 'CoastalPSGuides';
const title = 'Coastal PS Guides';
const output = path.join(root, 'dist');
const staged = path.join(output, prefix);
const textExtensions = new Set(['.lua', '.xml', '.toc']);
const dataAddons = ['Polestar_Codex', 'Polestar_QuestDB'];
const slashAliases = {
	'/polestar': '/cps',
	'/pole': '/coastalps',
	'/ps': '/coastalguides',
	'/polestarrec': '/coastalpsrec',
	'/psrec': '/cpsrec',
	'/arcade': '/cpsarcade',
	'/freedoom': '/cpsfreedoom',
	'/doom': '/cpsdoom',
};

function rename(text) {
	return text.replace(/\bPolestar(?=[A-Z_]|\b)/g, prefix);
}

function transform(text, addon, file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.toc') {
		text = text.replace(/^(## (?:Title(?:-\w+)?|Category): )Polestar[^\r\n]*/gm, (line, label) => {
			return label + title + (addon === 'Polestar' ? '' : line.slice(label.length + 'Polestar'.length));
		});
	} else if (ext === '.lua') {
		text = text
			.replace(/(?<![\w/.])\/(?:polestarrec|psrec|polestar|pole|ps)(?![\w-])/g,
				(command) => slashAliases[command])
			.replace(/(SLASH_POLESTAR_RL1 = ")\/rl"/g, '$1/cpsreload"')
			.replace(/(SLASH_POLESTARWAY1 = ")\/way"/g, '$1/cpsway"')
			.replace(/(?<=lower\(value\) == ")\/way(?=")/g, '/cpsway')
			.replace(/(SLASH_FREEDOOMARCADE[123] = ")(\/(?:arcade|freedoom|doom))"/g,
				(_match, assignment, command) => assignment + slashAliases[command] + '"')
			.replace(/"PolestarT1"/g, '"CoastalPST1"');
	}
	const namespace = (value) => rename(value).replace(/POLESTAR(?=\d|[A-Z_]|\b)/g, 'COASTALPSGUIDES')
		.replace(/FREEDOOMARCADE/g, 'COASTALPSGUIDESARCADE')
		.replace(/\bFreedoomArcade(?=DB\b|Frame\b)/g, 'CoastalPSGuidesArcade');
	// Keep distribution credits from the upstream addon manifests.
	return ext === '.toc'
		? text.split(/(\r?\n)/).map((line) => /^## (?:Author|X-License|X-Credits):/.test(line) ? line : namespace(line)).join('')
		: namespace(text);
}

function copyAddon(source, destination, addon) {
	fs.mkdirSync(destination);
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const from = path.join(source, entry.name);
		const to = path.join(destination, rename(entry.name));
		if (entry.isDirectory()) {
			copyAddon(from, to, addon);
		} else if (!entry.isFile()) {
			throw new Error('Unexpected link or special file: ' + from);
		} else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
			// Some generated Lua uses raw compressed bytes in string literals. All
			// substitutions are ASCII, so non-ASCII bytes must round-trip unchanged.
			fs.writeFileSync(to, transform(fs.readFileSync(from, 'latin1'), addon, entry.name), 'latin1');
		} else {
			fs.copyFileSync(from, to);
		}
	}
}

function checkDestination(install, name, target) {
	const link = path.join(install, name);
	const item = fs.lstatSync(link, { throwIfNoEntry: false });
	if (item && !(item.isSymbolicLink() && path.resolve(install, fs.readlinkSync(link)).toLowerCase() === target.toLowerCase())) {
		throw new Error('The install path is already occupied: ' + link);
	}
	return item ? null : link;
}

function main() {
	const { values } = parseArgs({ options: {
		source: { type: 'string', default: path.join(root, 'addon') },
		'data-addons': { type: 'string' },
		install: { type: 'string' },
	} });
	const source = path.resolve(values.source);
	const addons = new Map();
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^Polestar(?:_[A-Za-z0-9]+)*$/.test(entry.name) || entry.name === 'Polestar_Skin_Example') continue;
		const folder = path.join(source, entry.name);
		if (fs.existsSync(path.join(folder, entry.name + '.toc'))) addons.set(entry.name, folder);
	}

	for (const name of dataAddons) {
		if (addons.has(name) || !values['data-addons']) continue;
		const folder = path.join(path.resolve(values['data-addons']), name);
		if (fs.existsSync(path.join(folder, name + '.toc'))) {
			addons.set(name, folder);
			console.log('Using existing data for ' + name + ' from ' + folder);
		}
	}
	for (const name of ['Polestar', 'Polestar_Guides', 'Polestar_Nav', 'Polestar_Codex']) {
		if (!addons.has(name)) throw new Error('Missing ' + name + '. Build the addon data first or supply --data-addons.');
	}

	const install = values.install && fs.realpathSync(values.install);
	const links = [];
	if (install) {
		for (const name of addons.keys()) {
			const renamed = rename(name);
			const target = path.join(staged, renamed);
			const link = checkDestination(install, renamed, target);
			if (link) links.push([link, target]);
		}
	}

	fs.mkdirSync(output, { recursive: true });
	const workspace = fs.realpathSync(root);
	if (path.dirname(fs.realpathSync(output)) !== workspace) throw new Error('dist must be inside the checkout.');
	const previous = path.join(output, prefix + '-previous');
	const lock = path.join(output, prefix + '.lock');
	fs.mkdirSync(lock);
	const temporary = path.join(lock, 'addons');
	const created = [];
	let activated = false;
	let backedUp = false;
	try {
		if (fs.lstatSync(previous, { throwIfNoEntry: false })) throw new Error('Previous build needs review: ' + previous);
		const existing = fs.lstatSync(staged, { throwIfNoEntry: false });
		if (existing && (!existing.isDirectory() || existing.isSymbolicLink() ||
			!fs.existsSync(path.join(staged, prefix, prefix + '.toc')))) {
			throw new Error('Unexpected staging path: ' + staged);
		}
		fs.mkdirSync(temporary);
		for (const [name, folder] of addons) copyAddon(folder, path.join(temporary, rename(name)), name);
		if (existing) {
			fs.renameSync(staged, previous);
			backedUp = true;
		}
		fs.renameSync(temporary, staged);
		activated = true;
		for (const [link, target] of links) {
			fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
			created.push(link);
		}
	} catch (error) {
		for (const link of created) fs.unlinkSync(link);
		if (activated) fs.renameSync(staged, temporary);
		activated = false;
		if (backedUp) fs.renameSync(previous, staged);
		throw error;
	} finally {
		try {
			if (activated && backedUp && fs.existsSync(previous)) fs.rmSync(previous, { recursive: true });
		} finally {
			fs.rmSync(lock, { recursive: true });
		}
	}
	console.log(title + ': staged ' + addons.size + ' addons in ' + staged);
	if (install) console.log('Linked to ' + install + ' (' + links.length + ' new links)');
}

try {
	main();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
