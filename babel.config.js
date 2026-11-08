module.exports = {
  presets: [
    [
      'babel-preset-expo',
      {
        // Enable the unstable TransformImportMeta polyfill required by some packages
        // (e.g. zustand, wagmi) when running on Hermes / React Native.
        unstable_transformImportMeta: true,
        // Ensure all .mjs files are transformed
        inlineRequires: true,
      },
    ],
  ],
};
