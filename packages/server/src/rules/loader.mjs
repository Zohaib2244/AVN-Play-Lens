// Rules files: the bundled AVN plugin pack, plus one personal YAML file per game in
// ~/.avn-playlens/rules/<package>.yaml. Files are re-read when they change on disk,
// so editing a rule in any editor updates the checklist on save.
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLED_PACKS = join(here, '..', '..', '..', '..', 'rules', 'packs');
const SAFE_NAME = /^[\w.-]+\.ya?ml$/;

export function profileTemplate(pkg) {
  return `# Rules for ${pkg}, used by the AVN PlayLens checklist.
# Edit and save: the checklist updates straight away.
game: ${pkg}
name: ${pkg.split('.').pop()}

# Checks from the AVN plugin pack to include in every run.
# Options: startup-health, remote-config, interstitial-e2e, rewarded-e2e, app-open, banner, purchase
presets: [startup-health, remote-config]

options:
  byteBrew: false            # set true if this game defines USE_BYTEBREW

# Where the current level comes from, for the "interstitials from level N" ad rule.
# Leave it out to use any Firebase event parameter called level / level_number.
# level: { event: LEVEL_ANALYSIS, param: Started }
# level: { log: "/Level (\\d+) loaded/" }

# Events you expect to be sent, checked against Firebase's own debug log.
# params: required, type (number | string), oneOf: [a, b], range: [min, max], regex: "^[A-Z]{3}$"
expect:
  - id: level-start
    name: level_start is sent with a level number
    event: level_start
    sdk: firebase              # firebase | bytebrew
    params:
      level: { type: number, required: true }

  - id: level-complete
    event: level_complete
    sdk: firebase
    after: level-start         # must come after level_start
    params:
      level: { type: number, required: true }

# Extra log lines to flag (on top of the plugin pack's own rules).
watch:
  - id: example-game-error
    name: Save failed
    match: { level: E, message: /save failed/i }
    severity: warning
`;
}

export class RulesStore extends EventEmitter {
  constructor({ dir = join(os.homedir(), '.avn-playlens', 'rules'), packsDir = BUNDLED_PACKS } = {}) {
    packsDir ??= BUNDLED_PACKS;
    super();
    this.dir = dir;
    this.packsDir = packsDir;
    this.packs = new Map();
    this.loadPacks();
    this.watcher = null;
  }

  loadPacks() {
    this.packs.clear();
    let files = [];
    try { files = readdirSync(this.packsDir).filter((f) => SAFE_NAME.test(f)); } catch { /* none */ }
    for (const f of files) {
      try {
        const doc = yaml.load(readFileSync(join(this.packsDir, f), 'utf8'));
        if (doc?.pack) this.packs.set(doc.pack, doc);
      } catch (err) {
        this.emit('error', { file: f, message: err.message });
      }
    }
  }

  pack(id = 'avn-plugin') {
    return this.packs.get(id) ?? null;
  }

  list() {
    let files = [];
    try { files = readdirSync(this.dir).filter((f) => SAFE_NAME.test(f)); } catch { /* none yet */ }
    return files.map((file) => {
      const r = this.read(file);
      return { file, game: r.doc?.game ?? null, name: r.doc?.name ?? file, expect: r.doc?.expect?.length ?? 0, watch: r.doc?.watch?.length ?? 0, presets: r.doc?.presets ?? [], error: r.error };
    });
  }

  read(file) {
    if (!SAFE_NAME.test(file)) return { doc: null, error: 'bad file name' };
    try {
      return { doc: yaml.load(readFileSync(join(this.dir, file), 'utf8')) ?? {}, error: null };
    } catch (err) {
      return { doc: null, error: err.code === 'ENOENT' ? 'file not found' : err.message };
    }
  }

  forGame(pkg) {
    const match = this.list().find((f) => f.game === pkg) ?? this.list().find((f) => f.file === `${pkg}.yaml`);
    return match ? match.file : null;
  }

  create(pkg) {
    mkdirSync(this.dir, { recursive: true });
    const file = `${pkg}.yaml`;
    if (!SAFE_NAME.test(file)) throw new Error('bad package name');
    const path = join(this.dir, file);
    if (!existsSync(path)) writeFileSync(path, profileTemplate(pkg));
    return file;
  }

  watch() {
    mkdirSync(this.dir, { recursive: true });
    let timer = null;
    try {
      this.watcher = watch(this.dir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.emit('change'), 150);
      });
    } catch { /* watching unsupported: changes need a restart */ }
  }

  close() {
    this.watcher?.close();
  }
}
