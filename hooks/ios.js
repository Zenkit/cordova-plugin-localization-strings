var path = require('path');
var fs = require('fs-extra');
const {getLanguageFiles, readLanguageFileForPlatform, getLocaleFromFile} = require('./utils');

async function getXcodeProject({ctx}) {
  const {parse} = ctx.requireCordovaModule('cordova-ios/lib/projectFile');
  const root = path.join(ctx.opts.projectRoot, 'platforms', 'ios');

  const files = await fs.readdir(root);
  const xcodeproj = files.find(file => path.extname(file) === '.xcodeproj');
  if (!xcodeproj) {
    throw new PluginError(`Couldn't find xcode project ar ${root}`);
  }

  const pbxproj = path.join(root, xcodeproj, 'project.pbxproj');
  return parse({root, pbxproj});
}

function getLocalizationVariantGroupKey({project, name}) {
  const found = project.xcode.findPBXVariantGroupKey({name});
  if (found) {
    return found;
  }

  const group = project.xcode.addLocalizationVariantGroup(name);
  return group.fileRef;
}

async function writeLocalizedStringFile({project, locales, bundle = '', filename, strings}) {
  let content = '';
  for (const [key, value] of Object.entries(strings)) {
    content += `"${key}" = "${value}";\n`;
  }

  if (!content) {
    return;
  }

  // NOTE: It seems like we do not need to add the settings bundle to the project.
  // This is not tested and just copied from the original plugin
  const groupKey = bundle ? null : getLocalizationVariantGroupKey({project, name: filename});

  for (const locale of locales) {
    const file = path.join(bundle, `${locale}.lproj`, filename);
    await fs.outputFile(path.join(project.resources_dir, file), content);

    if (groupKey) {
      project.xcode.addResourceFile(file, {variantGroup: true}, groupKey);
    }
  }
}

const platform = 'ios';
module.exports = async function (ctx) {
  console.log('LocalizationStrings after prepare hook:');
  const files = await getLanguageFiles({ctx});
  if (!files.length) {
    return;
  }

  const project = await getXcodeProject({ctx});
  for (const file of files) {
    const {locales, app, config, settings, shortcuts} = await readLanguageFileForPlatform({file, platform});
    console.log('\t- adding:', locales.join(', '));

    await writeLocalizedStringFile({project, locales, filename: 'Localizable.strings', strings: app});
    await writeLocalizedStringFile({project, locales, filename: 'InfoPlist.strings', strings: config});
    await writeLocalizedStringFile({project, locales, filename: 'AppShortcuts.strings', strings: shortcuts});

    for (const [key, value] of Object.values(settings)) {
      await writeLocalizedStringFile({project, locales, bundle: 'Settings.bundle', filename: `${key}.strings`, strings: value});
    }
  }

  project.write();
  console.log('\tupdated pbx project');
};
