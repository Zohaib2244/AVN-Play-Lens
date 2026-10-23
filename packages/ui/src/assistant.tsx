import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cx } from './cx';
import { Icon } from './icons';
import { Button, Tag, type StatusKind } from './primitives';

/* ───────── Message model ───────── */

export type AnswerBlock =
  | { type: 'table'; title: string; columns: string[]; rows: ReactNode[][]; links?: Array<{ label: string; onClick: () => void }> }
  | { type: 'checklist'; title: string; rows: Array<{ title: string; detail: string; kind: StatusKind; tag: string; time?: string }>; links?: Array<{ label: string; onClick: () => void }> }
  | { type: 'chart'; title: string; chart: ReactNode; links?: Array<{ label: string; onClick: () => void }> }
  | { type: 'custom'; title: string; node: ReactNode }
  | { type: 'proposal'; title: string; preview?: ReactNode; confirmLabel: string; declineLabel?: string; onConfirm: () => void; onDecline?: () => void };

export type ToolCall = { name: string; args: string; done: boolean };
export type Pin = { title: string; value: string; sub: string };

export type NbMessage =
  | { role: 'user'; text: string }
  | { role: 'bot'; tools: ToolCall[]; text?: ReactNode; blocks?: AnswerBlock[]; scope?: string; pin?: Pin; done: boolean };

export type ContextChip = { id: string; label: string; /** the game chip can't be left out */ fixed?: boolean; off?: boolean };

/* ───────── Pieces ───────── */

/** "Used 2 tools" folds the work; open it to audit name and inputs of every call. */
export function ToolTrace({ tools, done }: { tools: ToolCall[]; done: boolean }): ReactElement | null {
  const [open, setOpen] = useState(!done);
  useEffect(() => { if (done) setOpen(false); }, [done]);
  if (!tools.length) return null;
  return (
    <div className="nb-work">
      <button type="button" className="nb-wh" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {done ? `Used ${tools.length} tool${tools.length > 1 ? 's' : ''}` : <><span className="spinner sm" aria-hidden="true" /> Working…</>}
        <Icon name="caret" />
      </button>
      <div className={cx('nb-wl', !open && 'shut')}>
        {tools.map((t, i) => (
          <div className="nb-tr" key={i}>
            {t.done ? <span className="okc"><Icon name="check" /></span> : <span className="spinner sm" aria-hidden="true" />}
            <span className="mono">{t.name}</span>
            <span className="dim mono" title={t.args}>{t.args}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Links({ links }: { links?: Array<{ label: string; onClick: () => void }> }): ReactElement | null {
  if (!links?.length) return null;
  return <div className="nb-bf">{links.map((l) => <Button key={l.label} size="sm" onClick={l.onClick}>{l.label}</Button>)}</div>;
}

/** Renders one answer block with the app's own components; proposals confirm before anything changes. */
export function Block({ block }: { block: AnswerBlock }): ReactElement {
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null);
  switch (block.type) {
    case 'table':
      return (
        <div className="nb-blk">
          <span className="eyebrow">{block.title}</span>
          <div className="t-wrap"><table className="t"><thead><tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{block.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
          <Links links={block.links} />
        </div>
      );
    case 'checklist':
      return (
        <div className="nb-blk">
          <span className="eyebrow">{block.title}</span>
          {block.rows.map((r, i) => (
            <div className="nb-ck" key={i}>
              <span className={cx('sic', r.kind === 'warn' ? 'done' : r.kind)}><Icon name={r.kind === 'bad' ? 'x' : 'check'} /></span>
              <span>{r.time ? <time>{r.time} </time> : null}<b>{r.title}</b><span className="s">{r.detail}</span></span>
              <Tag kind={r.kind}>{r.tag}</Tag>
            </div>
          ))}
          <Links links={block.links} />
        </div>
      );
    case 'chart':
      return <div className="nb-blk"><span className="eyebrow">{block.title}</span>{block.chart}<Links links={block.links} /></div>;
    case 'custom':
      return <div className="nb-blk"><span className="eyebrow">{block.title}</span>{block.node}</div>;
    case 'proposal':
      return (
        <div className="nb-prop">
          <b><Icon name="edit" />{block.title}</b>
          {block.preview}
          {decided === null ? (
            <div className="nb-pa">
              <Button size="sm" variant="primary" onClick={() => { setDecided('yes'); block.onConfirm(); }}>{block.confirmLabel}</Button>
              <Button size="sm" onClick={() => { setDecided('no'); block.onDecline?.(); }}>{block.declineLabel ?? 'Not now'}</Button>
            </div>
          ) : decided === 'yes' ? (
            <span className="dn"><Icon name="check" /> Done. Undo is in the toast.</span>
          ) : (
            <span className="dim" style={{ fontSize: 12.5 }}>Left as it was.</span>
          )}
        </div>
      );
  }
}

/* ───────── Panel ───────── */

export type NutBotPanelProps = {
  open: boolean;
  onClose: () => void;
  messages: NbMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onNew: () => void;
  context: ContextChip[];
  onToggleContext: (id: string) => void;
  suggestions: string[];
  subtitle?: string;
  onPin?: (pin: Pin) => void;
  /** The assistant's icon (the style's NutBot pixel icon). */
  face?: ReactNode;
};

/**
 * The assistant panel every AVN tool shares. The app supplies messages (built from its own tools);
 * this renders context chips, visible tool calls, answer blocks, proposal cards and the composer.
 */
export function NutBotPanel({ open, onClose, messages, busy, onSend, onNew, context, onToggleContext, suggestions, subtitle = 'Answers with this app’s tools · asks before changing anything', onPin, face }: NutBotPanelProps): ReactElement {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages, open]);

  const submit = () => { const t = text.trim(); if (t && !busy) { setText(''); onSend(t); } };

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          className="nb"
          aria-label="NutBot"
          style={{ animation: 'none' }}
          initial={reduce ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={reduce ? { opacity: 0 } : { x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        >
          <div className="nb-h">
            <span className={cx('nb-face', busy && 'think')}>{face}</span>
            <span className="sp1"><b>NutBot</b><small>{subtitle}</small></span>
            <button type="button" className="icon-btn" aria-label="New conversation" title="New conversation" onClick={onNew}><Icon name="edit" /></button>
            <button type="button" className="icon-btn" aria-label="Close NutBot" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="nb-ctx">
            <span>Looking at</span>
            {context.map((c) => (
              <span key={c.id} className={cx('ctxchip', c.off && 'off')}>
                {c.label}
                {c.fixed ? null : <button type="button" aria-label={`${c.off ? 'Use' : 'Ignore'} ${c.label}`} title={c.off ? 'Use this again' : 'Leave this out'} onClick={() => onToggleContext(c.id)}>{c.off ? '+' : '×'}</button>}
              </span>
            ))}
          </div>
          <div className="nb-list" ref={listRef} aria-live="polite">
            {messages.length ? messages.map((m, i) => (m.role === 'user' ? (
              <div className="nb-u" key={i}>{m.text}</div>
            ) : (
              <div className="nb-b" key={i}>
                <ToolTrace tools={m.tools} done={m.done} />
                {m.done ? (
                  <>
                    {m.text ? <div>{m.text}</div> : null}
                    {m.blocks?.map((b, j) => <Block key={j} block={b} />)}
                    {m.scope || m.pin ? (
                      <div className="nb-mf">
                        {m.scope ? <span>{m.scope}</span> : null}
                        {m.pin && onPin ? <PinButton onPin={() => onPin(m.pin as Pin)} /> : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))) : (
              <div className="nb-hello">
                <h3>Ask about this page</h3>
                <p>I use the same tools you see here, read what you’re looking at, and show answers as tables, charts and timelines. I only change things after you confirm.</p>
                <div className="nb-sug">{suggestions.map((s) => <button key={s} type="button" className="preset" onClick={() => !busy && onSend(s)}>{s}</button>)}</div>
              </div>
            )}
          </div>
          <form className="nb-in" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea
              aria-label="Message NutBot"
              rows={1}
              placeholder="Ask about what you’re looking at…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            />
            <Button variant="primary" type="submit" disabled={busy}>Send</Button>
          </form>
          <div className="nb-hint">Enter to send · Shift + Enter for a new line · Ctrl J to open or close</div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function PinButton({ onPin }: { onPin: () => void }): ReactElement {
  const [pinned, setPinned] = useState(false);
  return pinned ? <span className="dn" style={{ color: 'var(--ok)' }}>Pinned</span> : <Button size="sm" variant="ghost" onClick={() => { setPinned(true); onPin(); }}>Pin to Overview</Button>;
}
