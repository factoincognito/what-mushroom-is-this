/**
 * The app's own Android backup rules (docs/SPEC.md 3.6, PBI-1.9). Android 11 and lower read the
 * Auto Backup rules of `android:fullBackupContent`; Android 12 and higher read the data
 * extraction rules of `android:dataExtractionRules`, whose `device-transfer` section is the one
 * that counts on the phones where `android:allowBackup="false"` does not stop a transfer to a
 * new phone ("Back up user data with Auto Backup", developer.android.com).
 *
 * The rules keep expo-secure-store's own (its "Android Auto Backup" section: an app with its own
 * rules excludes `SecureStore` under `sharedpref` and sets `configureAndroidBackup` to false),
 * and add the exclusions the options give. No Expo mod writes a file of `res/xml`, so the files
 * are written by a dangerous mod; the manifest attributes are set by the manifest mod.
 */
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const BACKUP_RULES_RESOURCE = "app_backup_rules";
const DATA_EXTRACTION_RULES_RESOURCE = "app_data_extraction_rules";

/** The domains of the rules (developer.android.com, "Back up user data with Auto Backup"). */
const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

/** expo-secure-store's own rules, as its rules files hold them, in each section. */
const SECURE_STORE_RULES = [
  { kind: "include", domain: "sharedpref", path: "." },
  { kind: "exclude", domain: "sharedpref", path: "SecureStore" },
];

function fail(message) {
  return new Error(`withBackupRules: ${message}`);
}

/**
 * A path the rules accept: relative, without `..`, wildcards or characters XML would need to
 * escape. The page says the attribute takes no wildcard and no parent directory.
 */
function isRulePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    /^[A-Za-z0-9._/-]+$/.test(value)
  );
}

/** Checks the plugin's options and gives the exclusions, in order. */
function readOptions(options) {
  if (typeof options !== "object" || options === null || !Array.isArray(options.exclude)) {
    throw fail('the options need an "exclude" list');
  }
  if (options.exclude.length === 0) {
    throw fail('the "exclude" list is empty');
  }
  return options.exclude.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw fail(`exclude[${index}] is not an object`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== "domain" || keys[1] !== "path") {
      throw fail(`exclude[${index}] must have exactly "domain" and "path"`);
    }
    if (!DOMAINS.includes(entry.domain)) {
      throw fail(`exclude[${index}] has an unknown domain: ${String(entry.domain)}`);
    }
    if (!isRulePath(entry.path)) {
      throw fail(`exclude[${index}] has a path the rules do not take: ${String(entry.path)}`);
    }
    return { kind: "exclude", domain: entry.domain, path: entry.path };
  });
}

function ruleLines(rules, indent) {
  return rules.map(
    (rule) => `${indent}<${rule.kind} domain="${rule.domain}" path="${rule.path}"/>`,
  );
}

/** The rules for Android 11 and lower. */
function backupRulesXml(rules) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Written by plugins/withBackupRules.js; Auto Backup rules for Android 11 and lower. -->",
    "<full-backup-content>",
    ...ruleLines(rules, "  "),
    "</full-backup-content>",
    "",
  ].join("\n");
}

/** The rules for Android 12 and higher: the same rules for a cloud backup and a transfer. */
function dataExtractionRulesXml(rules) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Written by plugins/withBackupRules.js; data extraction rules for Android 12 and higher. -->",
    "<data-extraction-rules>",
    "  <cloud-backup>",
    ...ruleLines(rules, "    "),
    "  </cloud-backup>",
    "  <device-transfer>",
    ...ruleLines(rules, "    "),
    "  </device-transfer>",
    "</data-extraction-rules>",
    "",
  ].join("\n");
}

const withBackupRules = (config, options) => {
  const rules = [...SECURE_STORE_RULES, ...readOptions(options)];

  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application === undefined) {
      throw fail("the Android manifest has no <application>");
    }
    application.$["android:fullBackupContent"] = `@xml/${BACKUP_RULES_RESOURCE}`;
    application.$["android:dataExtractionRules"] = `@xml/${DATA_EXTRACTION_RULES_RESOURCE}`;
    return modConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const folder = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      await fs.promises.mkdir(folder, { recursive: true });
      await fs.promises.writeFile(
        path.join(folder, `${BACKUP_RULES_RESOURCE}.xml`),
        backupRulesXml(rules),
      );
      await fs.promises.writeFile(
        path.join(folder, `${DATA_EXTRACTION_RULES_RESOURCE}.xml`),
        dataExtractionRulesXml(rules),
      );
      return modConfig;
    },
  ]);
};

module.exports = withBackupRules;
module.exports.default = withBackupRules;
module.exports.BACKUP_RULES_RESOURCE = BACKUP_RULES_RESOURCE;
module.exports.DATA_EXTRACTION_RULES_RESOURCE = DATA_EXTRACTION_RULES_RESOURCE;
