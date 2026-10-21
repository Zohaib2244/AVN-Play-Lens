// Grouped view of warnings and errors: repeats merged with a count, sorted by who wrote
// them (your game, the AVN plugin, other SDKs, Android), with a plain meaning when known.
import { useMemo, useState } from 'react';
import { useApp, clock } from '../state.jsx';
import { cleanMessage } from '../pages/Logs.jsx';

const OWNERS = [
  { id: 'game', title: 'Your game', note: 'Logged by the game\'s own code.' },
  { id: 'avn', title: 'AVN plugin', note: 'Plugin warnings and errors. Plugin health explains most of them.' },
  { id: 'sdk', title: 'Other SDKs and plugins', note: 'Ad networks, Firebase, billing and other libraries.' },
  { id: 'android', title: 'Android and the phone', note: 'Lines from Android itself, the GPU driver or the runtime. Usually safe to ignore.' },
];
const LEVEL_WORD = { W: 'WARN', E: 'ERROR', F: 'FATAL' };

export function Grouped({ q, filter, onShow }) {
  const { groups, version } = useApp();
  const [open, setOpen] = useState(null);
  const [showSafe, setShowSafe] = useState(false);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...groups.current.values()].filter((g) => (filter === 'err' ? g.level !== 'W' : true)
      && (!needle || `${g.sample.message} ${g.tag} ${g.sdk ?? ''} ${(g.sample.more || []).join(' ')}`.toLowerCase().includes(needle)));
    return OWNERS.map((o) => {
      const items = list.filter((g) => g.owner === o.id).sort((a, b) => (b.level > a.level ? 1 : b.level < a.level ? -1 : 0) || b.count - a.count);
      return { ...o, items, total: items.reduce((n, g) => n + g.count, 0) };
    });
    // version changes whenever groups.current is updated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, q, filter]);

  const empty = sections.every((s) => !s.items.length);
  if (empty) return <div className="card empty">{q || filter !== 'all' ? 'No warnings or errors match.' : 'No warnings or errors yet. Nice.'}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {sections.filter((s) => s.items.length).map((s) => {
        const quiet = s.id === 'android' && !showSafe;
        return (
          <section key={s.id} className="card" style={{ overflow: 'hidden' }}>
            <div className="ghead">
              <span className={`odot o-${s.id}`} />
              <span style={{ fontWeight: 700, fontSize: 16 }}>{s.title}</span>
              <span className="mono dim" style={{ fontSize: 12.5 }}>{s.items.length} kind{s.items.length === 1 ? '' : 's'} · {s.total.toLocaleString()} line{s.total === 1 ? '' : 's'}</span>
              <span style={{ flex: '1 1 auto' }} />
              {s.id === 'android' && <button className="btn btn-sm" aria-pressed={showSafe} onClick={() => setShowSafe(!showSafe)}>{showSafe ? 'Hide' : 'Show'}</button>}
            </div>
            <div className="dim" style={{ fontSize: 13, padding: '0 20px 10px' }}>{s.note}</div>
            {!quiet && s.items.map((g) => {
              const isOpen = open === g.key;
              return (
                <div key={g.key}>
                  <button className={`grow${isOpen ? ' open' : ''}`} onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen}>
                    <span className="mono gcount">×{g.count.toLocaleString()}</span>
                    <span className={`lv lv-${g.level}`}>{LEVEL_WORD[g.level] ?? g.level}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="cell-msg" style={{ display: 'block' }}>{cleanMessage(g.sample)}</span>
                      {g.meaning && <span className="gmean">{g.meaning}</span>}
                    </span>
                    <span className="cell-from">{g.sdk ?? g.tag}</span>
                  </button>
                  {isOpen && (
                    <div className="detail" style={{ paddingLeft: 20 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', fontSize: 13.5, marginBottom: 10 }} className="mute">
                        <span>Tag <span className="mono">{g.tag}</span></span>
                        {g.sdk && <span>From <b>{g.sdk}</b></span>}
                        <span>First <span className="mono">{clock(g.first, false)}</span></span>
                        <span>Last <span className="mono">{clock(g.last, false)}</span></span>
                        {g.safe && <span className="tag tag-plain">safe to ignore</span>}
                      </div>
                      <div className="trace">{[cleanMessage(g.sample), ...(g.sample.more ?? [])].join('\n')}</div>
                      <div style={{ marginTop: 12 }}><button className="btn btn-sm" onClick={() => onShow(g.lastId)}>Show the latest one in the log</button></div>
                    </div>
                  )}
                </div>
              );
            })}
            {quiet && <div className="dim" style={{ fontSize: 13.5, padding: '4px 20px 16px' }}>Hidden. Press Show to list them.</div>}
          </section>
        );
      })}
    </div>
  );
}
