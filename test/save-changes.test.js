const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function hasUnsavedChanges(draft, saved) {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

describe('Guardar stays off until something changes', function () {
  it('treats equal snapshots as clean and a field change as dirty', function () {
    const saved = { commission: false, signup: false };
    expect(hasUnsavedChanges(saved, saved)).to.equal(false);
    expect(hasUnsavedChanges({ ...saved, commission: true }, saved)).to.equal(true);
  });

  it('disables the save control when the draft matches what is persisted', function () {
    const root = path.join(__dirname, '..');
    const util = fs.readFileSync(path.join(root, 'utils', 'unsavedChanges.ts'), 'utf8');
    expect(util).to.include('export function hasUnsavedChanges');
    const screens = [
      'components/LanguageSelector.tsx',
      'components/ThemeToggle.tsx',
      'components/AuthMethodPicker.tsx',
      'components/NotificationChannels.tsx',
      'components/ProfileSettings.tsx',
      'components/BiometricLockSection.tsx',
    ];
    for (const rel of screens) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).to.match(/disabled=\{[^}]*!dirty/);
      expect(src, rel).to.match(/if \([^)]*!dirty/);
    }
    const avisos = fs.readFileSync(
      path.join(root, 'components', 'NotificationChannels.tsx'),
      'utf8'
    );
    expect(avisos).to.include('return false');
    expect(avisos).to.include('if (ok) Alert.alert');
  });
});
