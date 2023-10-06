const path = require('path');
const fs = require('fs-extra');
const pkg = require('../package.json');

const PLUGIN_ID = pkg.name;
class PluginError extends Error {
  constructor(message) {
    super(`\x1b[1m\x1b[31m${message}\x1b[0m`);
    this.name = PLUGIN_ID;
  }
}

async function getPluginConfig({ctx}) {
  const plugins = await ctx.cordova.projectMetadata.getPlugins(ctx.opts.projectRoot);

  const plugin = plugins.find(plugin => plugin.name === PLUGIN_ID);
  if (!plugin) {
    throw new PluginError(`Couldn't find "${PLUGIN_ID}".`);
  }

  const config = {};
  for (const {name, value} of plugin.variables) {
    config[name] = value;
  }

  return config;
}

async function getLanguageFiles({ctx}) {
  const config = await getPluginConfig({ctx});
	const translationDir = config.TRANSLATION_PATH
	if (!translationDir) {
		throw new PluginError('Missing "TRANSLATION_PATH" variable.')
	}

  const files = [];
  const dir = path.join(ctx.opts.projectRoot, translationDir);
  for (const file of await fs.readdir(dir)) {
    if (path.extname(file) === '.json') {
      files.push(path.join(dir, file));
    }
  }

  if (!files.length) {
    console.warn('\tCould not find any language files in', translationDir);
  }

  return files;
}

function getLocaleFromFile(file) {
	return path.basename(file, '.json')
}

function getLocales({file, platform, translation}) {
  const locales = translation.locale && translation.locale[platform];
  return locales || [getLocaleFromFile(file)];
}

async function readLanguageFileForPlatform({file, platform}) {
  const raw = await fs.readJson(file);
  const locales = getLocales({file, platform, translation: raw});

  const app = {...raw.app, ...raw[`app_${platform}`]};
  const config = raw[`config_${platform}`] || {};
  const settings = raw[`settings_${platform}`] || {};
  const shortcuts = raw.app_shortcuts || {};

  return {locales, app, config, settings, shortcuts};
}

module.exports = {PluginError, getLanguageFiles, getLocaleFromFile, readLanguageFileForPlatform};
