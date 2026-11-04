// Vite 8 needs Node.js ^20.19.0 || >=22.12.0 and fails with an unhelpful error
// on older versions, so stop early with a clear message instead.
export function isSupportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  return major > 22;
}

if (!isSupportedNode(process.versions.node)) {
  console.error(
    `\nThis project needs Node.js 20.19+ or 22.12+ (you have ${process.versions.node}).\n` +
      'Vite 8 does not run on older versions. Install the current LTS from https://nodejs.org and try again.\n',
  );
  process.exit(1);
}
