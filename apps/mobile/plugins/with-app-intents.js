const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

const INTENTS = path.join(__dirname, "..", "ios-intents");
const APP_FILES = ["LabradoodleIntents.swift"];

/**
 * Adds the Shortcuts and Siri actions. App Intents must be compiled into the app target for
 * Shortcuts to find them, so the Swift files go there rather than into a local module's pod.
 * The app's default server is copied into Info.plist for a session that never chose one.
 */
function withAppIntents(config) {
  config = withInfoPlist(config, (config) => {
    const plist = config.modResults;
    plist.LabradoodleDefaultApiBase = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3100";
    return config;
  });

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const root = config.modRequest.platformProjectRoot;
    const name = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);

    for (const file of APP_FILES) {
      fs.copyFileSync(path.join(INTENTS, file), path.join(root, name, file));
      const filepath = `${name}/${file}`;
      if (!project.hasFile(filepath)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project });
      }
    }
    return config;
  });
}

module.exports = withAppIntents;
