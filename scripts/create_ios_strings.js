var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp").mkdirp;
var _ = require("underscore");
var xcode = require("xcode");
var utils = require("./utils");

var iosProjFolder;
var iosPbxProjPath;
var _context;

function jsonToDotStrings(jsonObj) {
	var returnString = "";
	_.forEach(jsonObj, function (val, key) {
		returnString += '"' + key + '" = "' + val + '";\n';
	});
	return returnString;
}

function getProjectName() {
	if(_context.opts.cordova.platforms.indexOf('ios') !== -1){
		const projectRoot = _context.opts.projectRoot;
		const platformPath = path.join(projectRoot, 'platforms', 'ios');
		const cordova_ios = require('cordova-ios');
		const iosProject = new cordova_ios('ios', platformPath);

		return path.basename(iosProject.locations.xcodeCordovaProj);
	}
	// Valid matches
	// '<name>Application one</name>',
  // '<name short="App1">Application one</name>',
  // '<name xmlns:widget="http://www.w3.org/ns/widgets">Application one</name>',
	// '<name >Application one</name>',
  // `<name
  //  >Application one</name>`,
	//
	// Invalid matches
	// '<name2>Application one</name>',
  // '<namefoo>Application one</name>',
  // '<name!!>Application one</name>',
	const regExpression = "<name(?=[\\s>])[^>]*>(.*?)</name>";

	var config = fs.readFileSync("config.xml").toString();
	var matches = config.match(new RegExp(regExpression, "i"));

	return (matches && matches[1]) || null;
}

function initIosDir() {
	if (!iosProjFolder || !iosPbxProjPath) {
		var projectName = getProjectName();
		iosProjFolder = "platforms/ios/" + projectName;
		iosPbxProjPath =
			"platforms/ios/" + projectName + ".xcodeproj/project.pbxproj";
	}
}

function getTargetIosDir() {
	initIosDir();
	return iosProjFolder;
}

function getXcodePbxProjPath() {
	initIosDir();
	return iosPbxProjPath;
}

function writeStringFile(plistStringJsonObj, lang, fileName, bundle) {
	var lProjPath =
		getTargetIosDir() +
		"/Resources/" +
		(bundle ? bundle + "/" : "") +
		lang +
		".lproj";
	mkdirp(lProjPath).then(function () {
		var stringToWrite = jsonToDotStrings(plistStringJsonObj);
		fs.writeFileSync(path.join(lProjPath, fileName), stringToWrite);
	});
}

// The cache has to be purged in the cordova-ios instance cordova uses for the platform.
// With another instance (e.g. a second copy of cordova-ios in the project) the platform
// writes its cached project later and the localization groups are gone.
function requireProjectFile(context, platformPath) {
	var projectFilePath = path.join(platformPath, "cordova", "lib", "projectFile.js");
	// Before cordova-ios 7 projectFile.js was part of the platform folder
	if (fs.existsSync(projectFilePath)) {
		return require(projectFilePath);
	}

	var platforms = context.requireCordovaModule("cordova-lib").cordova_platforms;
	var api = platforms.getPlatformApi("ios", platformPath);
	var apiModule = _.find(_.values(require.cache), function (module) {
		return module.exports === api.constructor;
	});
	if (!apiModule) {
		throw new Error("Couldn't find the cordova-ios module of the platform");
	}
	return require(path.join(path.dirname(apiModule.filename), "projectFile"));
}

// Like addLocalizationVariantGroup of xcode, but it also finds the resources group by path,
// since cordova-ios 8 the group has no name.
function addLocalizationVariantGroup(proj, name) {
	var groupKey = proj.pbxCreateVariantGroup(name);
	var resourcesGroupKey =
		proj.findPBXGroupKey({ name: "Resources" }) ||
		proj.findPBXGroupKey({ path: "Resources" });
	if (!resourcesGroupKey) {
		throw new Error("Couldn't find the resources group of the xcode project");
	}
	proj.addToPbxGroup(groupKey, resourcesGroupKey);

	var file = {
		uuid: proj.generateUuid(),
		fileRef: groupKey,
		basename: name,
		group: "Resources",
	};
	proj.addToPbxBuildFileSection(file);
	proj.addToPbxResourcesBuildPhase(file);
	return groupKey;
}

function writeLocalisationFieldsToXcodeProj(filePaths, groupName, proj) {
	var fileRefSection = proj.pbxFileReferenceSection();
	var fileRefValues = _.values(fileRefSection);

	if (filePaths.length > 0) {
		var groupKey = proj.findPBXVariantGroupKey({ name: groupName });
		if (!groupKey) {
			// findPBXVariantGroupKey with name InfoPlist.strings not found. creating new group
			groupKey = addLocalizationVariantGroup(proj, groupName);
		}

		filePaths.forEach(function (filePath) {
			var results = _.find(fileRefValues, function (o) {
				return (
					_.isObject(o) &&
					_.has(o, "path") &&
					o.path.replace(/['"]+/g, "") === filePath
				);
			});
			if (_.isUndefined(results)) {
				// not found in pbxFileReference yet

				// resource path used by cordova-ios 7.x and earlier
				var resourcePath = "Resources/" + filePath;

				// cordova-ios 8.x and later: the variant group is inside the resources group (App/Resources),
				// so the path is relative to it
				if (fs.existsSync(path.join("platforms", "ios", "App.xcodeproj"))) {
					resourcePath = filePath;
				}
				proj.addResourceFile(
					resourcePath,
					{ variantGroup: true },
					groupKey
				);
			}
		});
	}
}

module.exports = function (context) {
	var infoPlistPaths = [];
	var localizableStringsPaths = [];
	var settingsBundlePaths = [];
	var appShortcutsPaths = [];

	_context = context;

	return utils.getTargetLang(context).then(function (languages) {
		languages.forEach(function (lang) {
			// read the json file
			var langJson = require(lang.path);

			// check the locales to write to
			var localeLangs = [];
			if (_.has(langJson, "locale") && _.has(langJson.locale, "ios")) {
				// iterate the locales
				_.forEach(langJson.locale.ios, function (aLocale) {
					localeLangs.push(aLocale);
				});
			} else {
				// use the default lang from the filename, for example "en" in en.json
				localeLangs.push(lang.lang);
			}

			_.forEach(localeLangs, function (localeLang) {
				if (_.has(langJson, "config_ios")) {
					// do processing for appname into plist
					var plistString = langJson.config_ios;
					if (!_.isEmpty(plistString)) {
						writeStringFile(plistString, localeLang, "InfoPlist.strings");
						infoPlistPaths.push(localeLang + ".lproj/" + "InfoPlist.strings");
					}
				}

				// remove APP_NAME and write to Localizable.strings
				if (_.has(langJson, "app")) {
					// do processing for appname into plist
					var localizableStringsJson = langJson.app;

					// ios specific strings
					if (_.has(langJson, "app_ios")) {
						Object.assign(localizableStringsJson, langJson.app_ios);
					}

					if (!_.isEmpty(localizableStringsJson)) {
						writeStringFile(
							localizableStringsJson,
							localeLang,
							"Localizable.strings"
						);
						localizableStringsPaths.push(
							localeLang + ".lproj/" + "Localizable.strings"
						);
					}
				}

				if (
					_.has(langJson, "app_shortcuts") &&
					!_.isEmpty(langJson.app_shortcuts)
				) {
					writeStringFile(
						langJson.app_shortcuts,
						localeLang,
						"AppShortcuts.strings"
					);
					appShortcutsPaths.push(
						localeLang + ".lproj/" + "AppShortcuts.strings"
					);
				}

				// to create Settings.bundle localizations
				if (_.has(langJson, "settings_ios")) {
					var localizableSettingsJson = langJson.settings_ios;
					if (!_.isEmpty(localizableSettingsJson)) {
						_.each(localizableSettingsJson, function (value, key) {
							var settingsFileName = key + ".strings";
							var localizableSettingsStringsRoot = value;

							if (!_.isEmpty(localizableSettingsStringsRoot)) {
								writeStringFile(
									localizableSettingsStringsRoot,
									localeLang,
									settingsFileName,
									"Settings.bundle"
								);
								settingsBundlePaths.push(
									"Settings.bundle" + localeLang + ".lproj/" + settingsFileName
								);
							}
						});
					}
				}
			});
		});

		var pbxProjPath = getXcodePbxProjPath();
		var proj = xcode.project(pbxProjPath);

		return new Promise(function (resolve, reject) {
			proj.parse(function (error) {
				if (error) {
					reject(error);
				}

				writeLocalisationFieldsToXcodeProj(
					infoPlistPaths,
					"InfoPlist.strings",
					proj
				);
				writeLocalisationFieldsToXcodeProj(
					localizableStringsPaths,
					"Localizable.strings",
					proj
				);
				writeLocalisationFieldsToXcodeProj(
					appShortcutsPaths,
					"AppShortcuts.strings",
					proj
				);

				fs.writeFileSync(pbxProjPath, proj.writeSync());
				console.log(
					"Pbx project written with localization groups",
					_.map(languages, "lang")
				);

				var platformPath = path.join(
					context.opts.projectRoot,
					"platforms",
					"ios"
				);
				var projectFileApi = requireProjectFile(context, platformPath);
				projectFileApi.purgeProjectFileCache(platformPath);

				resolve();
			});
		});
	});
};
