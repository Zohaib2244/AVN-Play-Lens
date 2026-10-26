// Reads the identity of an Android build from its manifest without any SDK tools.
// APKs carry a binary XML manifest (AXML); app bundles carry aapt2's protobuf XML.

// android:versionCode, android:versionName, android:minSdkVersion. Obfuscated manifests can
// strip attribute names and keep only these resource ids.
const ATTR_IDS = { 0x0101021b: 'versionCode', 0x0101021c: 'versionName', 0x0101020c: 'minSdkVersion' };

function identity(manifest, usesSdk) {
  const code = Number(manifest.versionCode);
  const min = Number(usesSdk?.minSdkVersion);
  return {
    packageId: manifest.package || null,
    versionCode: Number.isFinite(code) && manifest.versionCode !== '' && manifest.versionCode != null ? code : null,
    versionName: manifest.versionName != null && manifest.versionName !== '' ? String(manifest.versionName) : null,
    minSdk: Number.isFinite(min) && usesSdk?.minSdkVersion != null ? min : null,
    split: manifest.split || null,
  };
}

function stringPool(buf, start) {
  const count = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = start + buf.readUInt32LE(start + 20);
  const utf8 = (flags & 0x100) !== 0;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(start + 28 + i * 4);
    if (utf8) {
      // UTF-16 length, then UTF-8 byte length; each one or two bytes.
      p += buf[p] & 0x80 ? 2 : 1;
      let len = buf[p];
      if (len & 0x80) { len = ((len & 0x7f) << 8) | buf[p + 1]; p += 2; } else p += 1;
      out[i] = buf.toString('utf8', p, p + len);
    } else {
      let len = buf.readUInt16LE(p);
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2); p += 4; } else p += 2;
      out[i] = buf.toString('utf16le', p, p + len * 2);
    }
  }
  return out;
}

// Binary XML: a string pool, a resource map, then start/end element chunks.
export function parseBinaryManifest(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) throw new Error('AndroidManifest.xml is not binary XML');
  let strings = [];
  let resIds = [];
  const found = {};
  let p = buf.readUInt16LE(2);
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) break;
    if (type === 0x0001) strings = stringPool(buf, p);
    else if (type === 0x0180) {
      resIds = [];
      for (let q = p + 8; q + 4 <= p + size; q += 4) resIds.push(buf.readUInt32LE(q));
    } else if (type === 0x0102) {
      const ext = p + buf.readUInt16LE(p + 2);
      const name = strings[buf.readUInt32LE(ext + 4)];
      if ((name === 'manifest' || name === 'uses-sdk') && !found[name]) {
        const attrStart = ext + buf.readUInt16LE(ext + 8);
        const attrSize = buf.readUInt16LE(ext + 10);
        const count = buf.readUInt16LE(ext + 12);
        const attrs = {};
        for (let i = 0; i < count; i++) {
          const a = attrStart + i * attrSize;
          const nameIdx = buf.readUInt32LE(a + 4);
          const key = ATTR_IDS[resIds[nameIdx]] ?? strings[nameIdx];
          const raw = buf.readUInt32LE(a + 8);
          const dataType = buf[a + 15];
          const data = buf.readUInt32LE(a + 16);
          if (raw !== 0xffffffff) attrs[key] = strings[raw];
          else if (dataType === 0x03) attrs[key] = strings[data];
          else if (dataType === 0x10 || dataType === 0x11) attrs[key] = data | 0;
          else attrs[key] = data;
        }
        found[name] = attrs;
      }
      if (found.manifest && found['uses-sdk']) break;
    }
    p += size;
  }
  if (!found.manifest) throw new Error('No <manifest> element in AndroidManifest.xml');
  return identity(found.manifest, found['uses-sdk']);
}

// Minimal protobuf reading: enough of aapt2's XmlNode / XmlElement / XmlAttribute.
function fields(buf) {
  const out = [];
  let p = 0;
  const varint = () => {
    let v = 0; let shift = 0; let b;
    do { b = buf[p++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80 && p < buf.length);
    return v;
  };
  while (p < buf.length) {
    const key = varint();
    const no = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) out.push({ no, value: varint() });
    else if (wire === 2) { const len = varint(); out.push({ no, bytes: buf.subarray(p, p + len) }); p += len; }
    else if (wire === 5) { out.push({ no, value: buf.readUInt32LE(p) }); p += 4; }
    else if (wire === 1) p += 8;
    else throw new Error('Unreadable protobuf manifest');
  }
  return out;
}

function protoAttr(bytes) {
  const f = fields(bytes);
  const name = f.find((x) => x.no === 2)?.bytes?.toString('utf8') ?? '';
  const resId = f.find((x) => x.no === 5)?.value;
  let value = f.find((x) => x.no === 3)?.bytes?.toString('utf8');
  if (value == null || value === '') {
    // compiled_item → Item: str (2) → String.value (1), or prim (7) → int decimal (6) / hex (7).
    const item = f.find((x) => x.no === 6)?.bytes;
    const itemFields = item ? fields(item) : [];
    const str = itemFields.find((x) => x.no === 2)?.bytes;
    const prim = itemFields.find((x) => x.no === 7)?.bytes;
    if (str) value = fields(str).find((x) => x.no === 1)?.bytes?.toString('utf8');
    else if (prim) value = fields(prim).find((x) => x.no === 6 || x.no === 7)?.value;
  }
  return { key: ATTR_IDS[resId] ?? name, value };
}

function protoElement(bytes) {
  const f = fields(bytes);
  return {
    name: f.find((x) => x.no === 3)?.bytes?.toString('utf8') ?? '',
    attrs: Object.fromEntries(f.filter((x) => x.no === 4).map((x) => { const a = protoAttr(x.bytes); return [a.key, a.value]; })),
    children: f.filter((x) => x.no === 5).map((x) => fields(x.bytes).find((y) => y.no === 1)?.bytes).filter(Boolean),
  };
}

export function parseProtoManifest(buf) {
  const root = fields(buf).find((x) => x.no === 1)?.bytes;
  if (!root) throw new Error('No <manifest> element in the bundle manifest');
  const manifest = protoElement(root);
  if (manifest.name !== 'manifest') throw new Error('No <manifest> element in the bundle manifest');
  const usesSdk = manifest.children.map(protoElement).find((c) => c.name === 'uses-sdk');
  return identity(manifest.attrs, usesSdk?.attrs);
}
