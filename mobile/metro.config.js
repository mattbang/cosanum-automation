const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Contracts and synthetic fixture are owned by the repository root, not copied into the app.
config.watchFolders = [path.resolve(__dirname, '..')];
module.exports = config;
