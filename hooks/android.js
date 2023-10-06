var path = require('path');
var fs = require('fs-extra');
var {xml2js, js2xml} = require('xml-js');
const {getLanguageFiles, readLanguageFileForPlatform} = require('./utils');

async function getDefaultLocale({ctx}) {
  const file = path.join(ctx.opts.projectRoot, 'config.xml');
  const xml = await fs.readFile(file, 'utf-8');
  const config = xml2js(xml, {compact: true});
  return config.widget._attributes.defaultLocale || 'en';
}

function getLocaleFilePath({locations, locale, defaultLocale}) {
  const values = locale === defaultLocale ? 'values' : `values-${locale}`;
  return path.join(locations.res, values, 'strings.xml');
}

function compileStrings(strings) {
  const values = [];
  for (const [key, raw] of Object.entries(strings)) {
    // positional string format is in Mac OS X format. change to android format
    const value = raw.replace(/\$@/gi, '$s').replace(/'/gi, "\\'");
    values.push({key, value});
  }
  return values;
}

async function readLocaleStrings(file) {
  if ((await fs.pathExists(file)) === false) {
    return {resources: {string: []}};
  }
  const xml = await fs.readFile(file, 'utf-8');
  const parsed = xml2js(xml, {compact: true});

  if (Array.isArray(parsed.resources.string) === false) {
    parsed.resources.string = [parsed.resources.string];
  }
  return parsed;
}

async function writeLocaleStrings({locations, locale, defaultLocale, strings}) {
  const file = getLocaleFilePath({locations, locale, defaultLocale});
  const xml = await readLocaleStrings(file);

  for (const {key, value} of strings) {
    const element = xml.resources.string.find(element => element._attributes.name === key);
    if (element) {
      element._text = value;
      continue;
    }

    xml.resources.string.push({_attributes: {name: key}, _text: value});
  }

  await fs.outputFile(file, js2xml(xml, {compact: true, spaces: 4}));
}

const platform = 'android';
module.exports = async function (ctx) {
  console.log('LocalizationStrings after prepare hook:');
  const files = await getLanguageFiles({ctx});
  if (!files.length) {
    return;
  }

  const defaultLocale = await getDefaultLocale({ctx});
  const root = path.join(ctx.opts.projectRoot, 'platforms', platform);
  const {locations} = ctx.requireCordovaModule('cordova-lib/src/platforms').getPlatformApi(platform, root);
  console.log('\tdefault locale:', defaultLocale);
  for (const file of files) {
    const {locales, app, config} = await readLanguageFileForPlatform({file, platform});
    console.log('\t- adding:', locales.join(', '));

    const strings = compileStrings({...app, ...config});
    if (!strings.length) {
      continue;
    }

    for (const locale of locales) {
      await writeLocaleStrings({locations, locale, defaultLocale, strings});
    }
  }
};
