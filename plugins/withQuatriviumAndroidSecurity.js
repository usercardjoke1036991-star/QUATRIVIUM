/**
 * Endurece el manifiesto Android de release (MobSF).
 * Debug / expo-dev-client sigue pudiendo usar HTTP a Metro.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function pngCrc(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc(body));
  return Buffer.concat([len, body, crc]);
}

/** Icono del arranque nativo del mismo verde que el fondo, para que Android 12 no dibuje un cuadrado. */
function solidSplashPng(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = 7;
      raw[i + 1] = 21;
      raw[i + 2] = 15;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hideNativeSplashMark(androidRoot) {
  const png = solidSplashPng(288, 288);
  const res = path.join(androidRoot, 'app/src/main/res');
  if (!fs.existsSync(res)) return;
  const stack = [res];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (name === 'splashscreen_logo.png') fs.writeFileSync(full, png);
    }
  }
  const stylesPath = path.join(res, 'values/styles.xml');
  if (!fs.existsSync(stylesPath)) return;
  let styles = fs.readFileSync(stylesPath, 'utf8');
  if (styles.includes('windowSplashScreenIconBackgroundColor')) return;
  styles = styles.replace(
    '<item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>',
    '<item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>\n    <item name="windowSplashScreenIconBackgroundColor">@color/splashscreen_background</item>'
  );
  fs.writeFileSync(stylesPath, styles, 'utf8');
}

const BLOCKED_ALWAYS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.USE_FINGERPRINT',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'android.permission.READ_APP_BADGE',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];

const NETWORK_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">quatriviumcredit.app</domain>
    <pin-set expiration="2027-10-01">
      <pin digest="SHA-256">hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=</pin>
      <pin digest="SHA-256">Vfd95BwDeSQo+NUYxVEEIlvkOlWY2SalKK1lPhzOx78=</pin>
      <pin digest="SHA-256">QXnt2YHvdHR3tJYmQIr0PaFZRMdIT8j0E5L/+G5kQcE=</pin>
      <pin digest="SHA-256">mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=</pin>
    </pin-set>
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;

const RELEASE_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" tools:node="remove" />
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove" />
  <uses-permission android:name="android.permission.USE_FINGERPRINT" tools:node="remove" />
  <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" tools:node="remove" />
  <uses-permission android:name="com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE" tools:node="remove" />
  <uses-permission android:name="com.sec.android.provider.badge.permission.READ" tools:node="remove" />
  <uses-permission android:name="com.sec.android.provider.badge.permission.WRITE" tools:node="remove" />
  <uses-permission android:name="com.htc.launcher.permission.READ_SETTINGS" tools:node="remove" />
  <uses-permission android:name="com.htc.launcher.permission.UPDATE_SHORTCUT" tools:node="remove" />
  <uses-permission android:name="com.sonyericsson.home.permission.BROADCAST_BADGE" tools:node="remove" />
  <uses-permission android:name="com.sonymobile.home.permission.PROVIDER_INSERT_BADGE" tools:node="remove" />
  <uses-permission android:name="com.anddoes.launcher.permission.UPDATE_COUNT" tools:node="remove" />
  <uses-permission android:name="com.majeur.launcher.permission.UPDATE_BADGE" tools:node="remove" />
  <uses-permission android:name="com.huawei.android.launcher.permission.CHANGE_BADGE" tools:node="remove" />
  <uses-permission android:name="com.huawei.android.launcher.permission.READ_SETTINGS" tools:node="remove" />
  <uses-permission android:name="com.huawei.android.launcher.permission.WRITE_SETTINGS" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_APP_BADGE" tools:node="remove" />
  <uses-permission android:name="com.oppo.launcher.permission.READ_SETTINGS" tools:node="remove" />
  <uses-permission android:name="com.oppo.launcher.permission.WRITE_SETTINGS" tools:node="remove" />
  <uses-permission android:name="me.everything.badger.permission.BADGE_COUNT_READ" tools:node="remove" />
  <uses-permission android:name="me.everything.badger.permission.BADGE_COUNT_WRITE" tools:node="remove" />
  <application
      android:usesCleartextTraffic="false"
      android:networkSecurityConfig="@xml/network_security_config"
      tools:replace="android:usesCleartextTraffic">
    <activity android:name="expo.modules.devlauncher.launcher.DevLauncherActivity" tools:node="remove" />
    <activity android:name="expo.modules.devlauncher.compose.AuthActivity" tools:node="remove" />
    <activity android:name="androidx.compose.ui.tooling.PreviewActivity" tools:node="remove" />
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="exp+quatrivium-sovereign" tools:node="remove" />
        <data android:scheme="exp+quatrivium-credit" tools:node="remove" />
        <data android:scheme="exp+magno" tools:node="remove" />
      </intent-filter>
    </activity>
    <activity
        android:name="com.canhub.cropper.CropImageActivity"
        android:exported="false"
        tools:replace="android:exported" />
    <receiver android:name="com.google.firebase.iid.FirebaseInstanceIdReceiver" tools:node="remove" />
    <receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" tools:node="remove" />
  </application>
</manifest>
`;

function ensureToolsNs(manifest) {
  manifest.manifest.$ = manifest.manifest.$ || {};
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
}

function isExpPlusScheme(scheme) {
  return String(scheme || '').startsWith('exp+');
}

function stripExpPlusData(dataNode) {
  if (!dataNode) return undefined;
  const items = Array.isArray(dataNode) ? dataNode : [dataNode];
  const kept = items.filter((item) => !isExpPlusScheme(item?.$?.['android:scheme']));
  if (kept.length === 0) return undefined;
  return Array.isArray(dataNode) ? kept : kept[0];
}

function stripExpPlusFromManifest(manifest) {
  const apps = manifest.manifest?.application;
  const app = Array.isArray(apps) ? apps[0] : apps;
  if (!app?.activity) return;
  const activities = Array.isArray(app.activity) ? app.activity : [app.activity];
  for (const activity of activities) {
    const filters = activity['intent-filter'];
    if (!filters) continue;
    const list = Array.isArray(filters) ? filters : [filters];
    for (const filter of list) {
      const next = stripExpPlusData(filter.data);
      if (!next) delete filter.data;
      else filter.data = next;
    }
  }
}

/** Metro/dev-client schemes must not ship in the release APK. */
function stripExpPlusFromManifestXml(xml) {
  const src = String(xml);
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('<data', i);
    if (start < 0) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, start);
    const end = src.indexOf('>', start);
    if (end < 0) {
      out += src.slice(start);
      break;
    }
    const tag = src.slice(start, end + 1);
    if (!tag.includes('android:scheme="exp+')) out += tag;
    i = end + 1;
  }
  return out;
}

const DEEP_HOSTS = ['quatriviumcredit.app'];
const DEEP_PATHS = ['/invite', '/history', '/room'];

function ensureHttpsDeepLinks(xml) {
  let next = String(xml);
  for (const host of DEEP_HOSTS) {
    for (const prefix of DEEP_PATHS) {
      const marker = `android:host="${host}" android:pathPrefix="${prefix}"`;
      if (next.includes(marker)) continue;
      const invite = `<data android:scheme="https" android:host="${host}" android:pathPrefix="/invite"/>`;
      const tag = `<data android:scheme="https" android:host="${host}" android:pathPrefix="${prefix}"/>`;
      if (next.includes(invite)) {
        next = next.replace(invite, `${invite}\n        ${tag}`);
      }
    }
  }
  return next;
}

function addRemovePermission(manifest, name) {
  if (!manifest.manifest['uses-permission']) {
    manifest.manifest['uses-permission'] = [];
  }
  const perms = manifest.manifest['uses-permission'];
  const already = perms.some(
    (item) => item.$?.['android:name'] === name && item.$?.['tools:node'] === 'remove'
  );
  if (!already) {
    perms.push({
      $: {
        'android:name': name,
        'tools:node': 'remove',
      },
    });
  }
}

function withQuatriviumAndroidSecurity(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    ensureToolsNs(manifest);
    for (const name of BLOCKED_ALWAYS) {
      addRemovePermission(manifest, name);
    }

    const apps = manifest.manifest.application;
    const app = Array.isArray(apps) ? apps[0] : apps;
    if (app && app.$) {
      app.$['android:allowBackup'] = 'false';
      const replace = String(app.$['tools:replace'] || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (!replace.includes('android:allowBackup')) replace.push('android:allowBackup');
      app.$['tools:replace'] = replace.join(',');
      app.activity = app.activity || [];
      const cropName = 'com.canhub.cropper.CropImageActivity';
      let crop = app.activity.find((item) => item.$?.['android:name'] === cropName);
      if (!crop) {
        crop = { $: { 'android:name': cropName } };
        app.activity.push(crop);
      }
      crop.$['android:exported'] = 'false';
      crop.$['tools:replace'] = 'android:exported';
      stripExpPlusFromManifest(manifest);
    }
    return cfg;
  });

  const versionName = String(config.version || '1.0.2');

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const xmlDir = path.join(androidRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_XML, 'utf8');
      const releaseDir = path.join(androidRoot, 'app/src/release');
      fs.mkdirSync(releaseDir, { recursive: true });
      fs.writeFileSync(path.join(releaseDir, 'AndroidManifest.xml'), RELEASE_MANIFEST, 'utf8');

      const mainManifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml');
      if (fs.existsSync(mainManifestPath)) {
        let mainXml = fs.readFileSync(mainManifestPath, 'utf8');
        mainXml = stripExpPlusFromManifestXml(mainXml);
        mainXml = ensureHttpsDeepLinks(mainXml);
        fs.writeFileSync(mainManifestPath, mainXml, 'utf8');
      }

      const gradlePath = path.join(androidRoot, 'app/build.gradle');
      if (fs.existsSync(gradlePath)) {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
        if (!gradle.includes("abiFilters 'armeabi-v7a', 'arm64-v8a'")) {
          gradle = gradle.replace(
            /(signingConfig signingConfigs\.release\.storeFile \? signingConfigs\.release : signingConfigs\.debug\r?\n)/,
            `$1            ndk {\n                abiFilters 'armeabi-v7a', 'arm64-v8a'\n            }\n`
          );
        }
        fs.writeFileSync(gradlePath, gradle, 'utf8');
      }

      const proguardPath = path.join(androidRoot, 'app/proguard-rules.pro');
      if (fs.existsSync(proguardPath)) {
        let rules = fs.readFileSync(proguardPath, 'utf8');
        if (!rules.includes('-dontwarn java.awt.Component')) {
          rules += `

# JNA desktop stubs pulled by WalletConnect; they do not exist on Android.
-dontwarn java.awt.Component
-dontwarn java.awt.**
-dontwarn javax.swing.**
-dontwarn com.sun.jna.**
`;
        }
        if (!rules.includes('public static *** *(...)')) {
          rules = rules.replace(
            /-assumenosideeffects class android\.util\.Log \{[\s\S]*?\}/,
            `-assumenosideeffects class android.util.Log {
    public static *** *(...);
}`
          );
          if (!rules.includes('public static *** *(...)')) {
            rules += `

# Strip android.util.Log in release (MobSF CWE-532).
-assumenosideeffects class android.util.Log {
    public static *** *(...);
}
`;
          }
        }
        fs.writeFileSync(proguardPath, rules, 'utf8');
      }
      hideNativeSplashMark(androidRoot);
      return cfg;
    },
  ]);

  config = withGradleProperties(config, (cfg) => {
    const setProp = (key, value) => {
      const idx = cfg.modResults.findIndex((item) => item.type === 'property' && item.key === key);
      const prop = { type: 'property', key, value };
      if (idx >= 0) cfg.modResults[idx] = prop;
      else cfg.modResults.push(prop);
    };
    setProp('android.enableMinifyInReleaseBuilds', 'true');
    setProp('android.enableShrinkResourcesInReleaseBuilds', 'true');
    return cfg;
  });

  return config;
}

module.exports = withQuatriviumAndroidSecurity;
module.exports.stripExpPlusFromManifestXml = stripExpPlusFromManifestXml;
module.exports.ensureHttpsDeepLinks = ensureHttpsDeepLinks;
module.exports.solidSplashPng = solidSplashPng;
module.exports.hideNativeSplashMark = hideNativeSplashMark;
