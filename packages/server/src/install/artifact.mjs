// Inspects an APK or app bundle on disk: what it is, which game, which version, and whether
// a phone can take it. Reads only the ZIP directory and the manifest, never the whole file.
import { open, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { basename } from 'node:path';
import { zipNames } from '../device/profile.mjs';
import { parseBinaryManifest, parseProtoManifest } from './manifest.mjs';

export class ArtifactError extends Error {
  constructor(code, message, hint = null) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.statusCode = 400;
  }
}

export const ARTIFACT_EXT = /\.(apk|aab)$/i;

// macOS asks before a program reads Desktop, Documents or Downloads. A refusal looks like EPERM.
export function fileError(err, path) {
  if (err instanceof ArtifactError) return err;
  if (err.code === 'ENOENT') return new ArtifactError('not-found', `File not found: ${path}`, 'Check the path, or rebuild the game if the file was cleaned up.');
  if (err.code === 'EACCES' || err.code === 'EPERM') {
    return new ArtifactError('no-access', `PlayLens is not allowed to read ${path}`,
      process.platform === 'darwin'
        ? 'Allow the terminal that runs PlayLens in System Settings → Privacy & Security → Files and Folders (or Full Disk Access), then try again.'
        : 'Check the file permissions.');
  }
  if (err.code === 'EISDIR') return new ArtifactError('is-folder', `${path} is a folder, not an APK or AAB file`);
  return new ArtifactError('read-failed', `Could not read ${path}: ${err.message}`);
}

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

async function zipDirectory(fh, size) {
  let tail = await readAt(fh, Math.max(0, size - 1048576), Math.min(size, 1048576));
  let r = zipNames(tail, size);
  if (!r.names && r.need && r.need <= size) {
    tail = await readAt(fh, size - r.need, r.need);
    r = zipNames(tail, size);
  }
  return r.names ? r : null;
}

async function readEntry(fh, file) {
  const head = await readAt(fh, file.local, 30);
  if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new ArtifactError('damaged', 'The file is damaged (bad ZIP entry). Rebuild it.');
  const start = file.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = await readAt(fh, start, file.csize);
  if (file.method === 0) return data;
  if (file.method === 8) return inflateRawSync(data);
  throw new ArtifactError('damaged', `Unsupported compression in ${file.name}`);
}

export async function inspectArtifact(path) {
  const name = basename(path);
  let fh;
  let info;
  try {
    info = await stat(path);
    if (info.isDirectory()) throw Object.assign(new Error('folder'), { code: 'EISDIR' });
    fh = await open(path, 'r');
  } catch (err) { throw fileError(err, path); }
  try {
    if (/\.apks$/i.test(name)) throw new ArtifactError('apks', 'APK sets (.apks) are not supported', 'Give PlayLens the .aab or a universal .apk instead.');
    if (/\.xapk$/i.test(name)) throw new ArtifactError('xapk', 'XAPK files are not supported', 'Give PlayLens the .apk or .aab from the Unity build.');
    if (info.size === 0) throw new ArtifactError('empty', `${name} is empty`, 'The build may still be writing it, or it failed. Wait for the build to finish.');
    const dir = await zipDirectory(fh, info.size).catch((err) => { throw err instanceof ArtifactError ? err : fileError(err, path); });
    if (!dir) throw new ArtifactError('not-zip', `${name} is not a valid APK or AAB`, 'It is not a ZIP archive. It may still be being written by the build, or it is damaged.');
    const byName = new Map(dir.files.map((f) => [f.name, f]));
    // Decide by content, not extension: a renamed bundle is still a bundle.
    const bundleManifest = byName.get('base/manifest/AndroidManifest.xml');
    const apkManifest = byName.get('AndroidManifest.xml');
    let kind;
    let manifest;
    try {
      if (bundleManifest) { kind = 'aab'; manifest = parseProtoManifest(await readEntry(fh, bundleManifest)); }
      else if (apkManifest) { kind = 'apk'; manifest = parseBinaryManifest(await readEntry(fh, apkManifest)); }
      else throw new ArtifactError('not-android', `${name} is a ZIP but not an Android APK or app bundle`, 'There is no AndroidManifest.xml inside.');
    } catch (err) {
      if (err instanceof ArtifactError) throw err;
      throw new ArtifactError('bad-manifest', `Could not read the manifest in ${name}: ${err.message}`, 'The file may be damaged. Rebuild it.');
    }
    if (!manifest.packageId) throw new ArtifactError('bad-manifest', `The manifest in ${name} has no package ID`);
    if (manifest.split) throw new ArtifactError('split-apk', `${name} is a split APK (${manifest.split}), not a whole app`, 'Give PlayLens the base APK built with "Split APKs by target architecture" off, or the .aab.');
    const libPrefix = kind === 'aab' ? /^base\/lib\/([^/]+)\// : /^lib\/([^/]+)\//;
    const abis = [...new Set(dir.names.map((n) => libPrefix.exec(n)?.[1]).filter(Boolean))].sort();
    return {
      path, name, kind, size: info.size, modifiedAt: Math.round(info.mtimeMs),
      fingerprint: `${info.size}:${Math.round(info.mtimeMs)}`,
      packageId: manifest.packageId, versionCode: manifest.versionCode, versionName: manifest.versionName, minSdk: manifest.minSdk,
      abis,
    };
  } finally {
    await fh?.close().catch(() => {});
  }
}

// Checks that need the phone: Android version and CPU architecture. Null when it can take it.
export function deviceMismatch(artifact, device) {
  if (artifact.minSdk && device.sdk && device.sdk < artifact.minSdk) {
    return new ArtifactError('older-sdk', `This build needs Android API ${artifact.minSdk} or newer; the phone runs API ${device.sdk}`,
      'Lower Minimum API Level in Unity Player Settings, or use a newer phone.');
  }
  if (artifact.kind === 'apk' && artifact.abis.length && device.abis?.length && !artifact.abis.some((a) => device.abis.includes(a))) {
    return new ArtifactError('no-matching-abi', `This build has native code for ${artifact.abis.join(', ')} only; the phone supports ${device.abis.join(', ')}`,
      'Enable the phone\'s architecture under Target Architectures in Unity Player Settings (usually ARM64 and ARMv7).');
  }
  return null;
}
