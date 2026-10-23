import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { AppContainerProvider, useAppContainer } from './context';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export type NavItem = { id: string; label: string; icon: IconName; /** something needs a look */ count?: number; countKind?: 'warn' | 'bad' | 'info'; /** pulsing live dot */ live?: boolean };
export type NavGroup = { label: string; items: NavItem[]; /** collapsible group, e.g. Manage */ collapsible?: boolean; defaultClosed?: boolean };

/**
 * The app frame. `.app-root` is the size container the responsive rules measure,
 * `.app` holds the sidebar, workspace and tab bar. Overlays (drawer, dialog, popovers)
 * render inside it so they stay within the frame.
 */
export function AppShell({ sidebar, tabbar, children, density = 'compact', className }: { sidebar: ReactNode; tabbar?: ReactNode; children: ReactNode; density?: 'compact' | 'comfort'; className?: string }): ReactElement {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <div className="app-root">
      <div className={cx('app', className)} ref={setEl} data-density={density}>
        <AppContainerProvider appEl={el}>
          {sidebar}
          {children}
          {tabbar}
        </AppContainerProvider>
      </div>
    </div>
  );
}

export function Brand({ mark, name, onClick }: { mark: ReactNode; name: string; onClick?: () => void }): ReactElement {
  return (
    <div className="brand" role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }} title="All games">
      <div className="mark px-mark">{mark}</div>
      <div className="brand-t">{name}</div>
    </div>
  );
}

export function GameSwitcher({ icon, name, packageName, onClick }: { icon: string; name: string; packageName: string; onClick?: () => void }): ReactElement {
  return (
    <button type="button" className="game" title={name} onClick={onClick}>
      <span className="g-ic">{icon}</span>
      <span style={{ minWidth: 0 }}>
        <b>{name}</b>
        <small>{packageName}</small>
      </span>
      <Icon name="caret" />
    </button>
  );
}

/** Grouped navigation with one highlight pill that slides to the active item. */
export function SidebarNav({ groups, active, onSelect, label = 'Game' }: { groups: NavGroup[]; active: string | null; onSelect: (id: string) => void; label?: string }): ReactElement {
  const reduce = useReducedMotion();
  const [closed, setClosed] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.filter((g) => g.collapsible).map((g) => [g.label, !!g.defaultClosed])));
  // An active item inside a closed group opens it.
  useEffect(() => {
    const g = groups.find((x) => x.items.some((i) => i.id === active));
    if (g?.collapsible && closed[g.label]) setClosed((c) => ({ ...c, [g.label]: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <nav className="nav" aria-label={label}>
      <LayoutGroup id="sidebar-nav">
        {groups.map((g) => {
          const shut = g.collapsible && closed[g.label];
          return (
            <div key={g.label} className={cx('grp', shut && 'closed')}>
              {g.collapsible ? (
                <button type="button" className="grp-label" aria-expanded={!shut} onClick={() => setClosed((c) => ({ ...c, [g.label]: !c[g.label] }))}>
                  <span className="eyebrow">{g.label}</span>
                  <Icon name="caret" />
                </button>
              ) : (
                <div className="grp-label static"><span className="eyebrow">{g.label}</span></div>
              )}
              <div className="grp-body">
                <div>
                  {g.items.map((item) => (
                    <NavButton key={item.id} item={item} active={item.id === active} onSelect={onSelect} reduce={!!reduce} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </LayoutGroup>
    </nav>
  );
}

function NavButton({ item, active, onSelect, reduce }: { item: NavItem; active: boolean; onSelect: (id: string) => void; reduce: boolean }): ReactElement {
  return (
    <button type="button" className={cx('ni', active && 'on')} title={item.label} aria-current={active ? 'page' : undefined} onClick={() => onSelect(item.id)} style={{ position: 'relative' }}>
      {active ? (
        <motion.span
          layoutId="nav-highlight"
          className="nav-ind"
          style={{ opacity: 1, zIndex: 0, transition: 'none' }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
        />
      ) : null}
      <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 11, width: '100%' }}>
        <Icon name={item.icon} />
        <span className="lbl">{item.label}</span>
        {item.count ? <span className={cx('cnt', item.countKind ?? 'warn')}>{item.count}</span> : null}
        {item.live ? <span className="live" title="Receiving events" /> : null}
      </span>
    </button>
  );
}

export type AccountItem = { id: string; label: string; icon: IconName };

/** Bottom-of-sidebar account button; its menu holds the admin pages (workspaces, team, status, settings). */
export function AccountMenu({ name, role, initial, items, onSelect }: { name: string; role: string; initial: string; items: AccountItem[]; onSelect: (id: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="acct" ref={ref}>
      {open ? (
        <div className="menu" role="menu">
          {items.map((it, i) => (
            <div key={it.id}>
              {i === items.length - 1 && items.length > 1 ? <hr /> : null}
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onSelect(it.id); }}>
                <Icon name={it.icon} />
                {it.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className="acct-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <span className="av">{initial}</span>
        <div>
          <b>{name}</b>
          <small>{role}</small>
        </div>
      </button>
    </div>
  );
}

export function Sidebar({ children }: { children: ReactNode }): ReactElement {
  return <aside className="side">{children}</aside>;
}

export function Workspace({ children }: { children: ReactNode }): ReactElement {
  return <div className="workspace">{children}</div>;
}

export type Crumb = { label: string; onClick?: () => void };

export function TopBar({ crumbs, mobileTitle, tools }: { crumbs: Crumb[]; mobileTitle?: ReactNode; tools?: ReactNode }): ReactElement {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${c.label}-${i}`} style={{ display: 'inline-flex', gap: 8 }}>
              {i > 0 ? <span>/</span> : null}
              {last ? <b>{c.label}</b> : c.onClick ? <button type="button" className="crumb-link" onClick={c.onClick}>{c.label}</button> : <span>{c.label}</span>}
            </span>
          );
        })}
      </div>
      {mobileTitle ? <div className="m-title">{mobileTitle}</div> : null}
      <div className="tools">{tools}</div>
    </header>
  );
}

export function SearchButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button type="button" className="search-btn" aria-label="Search (Ctrl K)" onClick={onClick}>
      <Icon name="search" />
      <span className="lbl">Search…</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}

export function IconButton({ icon, label, onClick, badge }: { icon: IconName; label: string; onClick?: () => void; badge?: ReactNode }): ReactElement {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
      {badge}
    </button>
  );
}

export function PageHead({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }): ReactElement {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Page content: new blocks rise in one after another when the page key changes. */
export function Page({ pageKey, children }: { pageKey: string; children: ReactNode }): ReactElement {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={pageKey}
        className="content"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
        transition={{ duration: reduce ? 0 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}

/* ───────── Phone tab bar ───────── */

export function TabBar({ items, active, onSelect, moreItems, onMore }: { items: NavItem[]; active: string | null; onSelect: (id: string) => void; moreItems?: boolean; onMore?: () => void }): ReactElement {
  const reduce = useReducedMotion();
  return (
    <nav className="tabbar" aria-label="Main">
      <LayoutGroup id="tabbar">
        {items.map((it) => (
          <button key={it.id} type="button" className={cx('tab', it.id === active && 'on')} aria-current={it.id === active ? 'page' : undefined} onClick={() => onSelect(it.id)} style={{ position: 'relative' }}>
            {it.id === active ? <motion.span layoutId="tab-ind" className="tab-ind" style={{ left: '50%', marginLeft: -14, transition: 'none' }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }} /> : null}
            <Icon name={it.icon} />
            <span>{it.label}</span>
          </button>
        ))}
        {moreItems ? (
          <button type="button" className="tab" onClick={onMore}>
            <Icon name="more" />
            <span>More</span>
          </button>
        ) : null}
      </LayoutGroup>
    </nav>
  );
}

/** The "More" bottom sheet on phones. */
export function MoreSheet({ open, onClose, sections, onSelect }: { open: boolean; onClose: () => void; sections: Array<{ label: string; items: Array<{ id: string; label: string; icon: IconName }> }>; onSelect: (id: string) => void }): ReactElement {
  const reduce = useReducedMotion();
  const app = useAppContainer();
  void app;
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div key="bg" className="sheet-bg" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div key="sheet" className="sheet" role="dialog" aria-label="More" style={{ animation: 'none' }} initial={reduce ? false : { y: '100%' }} animate={{ y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}>
            <div className="grab" />
            {sections.map((s) => (
              <div key={s.label}>
                <span className="eyebrow">{s.label}</span>
                {s.items.map((i) => (
                  <button key={i.id} type="button" className="ni" onClick={() => { onClose(); onSelect(i.id); }}>
                    <Icon name={i.icon} />
                    <span className="lbl">{i.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ───────── Command palette ───────── */

export type CommandItem = { id: string; group: 'Pages' | 'Games' | 'Actions' | string; label: string; icon: IconName; hint?: string; run: () => void };

/** Prefix beats contains beats hint match beats in-order letters. 0 = no match. */
export function scoreCommand(item: Pick<CommandItem, 'label' | 'hint'>, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = item.label.toLowerCase();
  if (t.startsWith(q)) return 4;
  if (t.includes(q)) return 3;
  if ((item.hint ?? '').toLowerCase().includes(q)) return 2;
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
  return j === q.length ? 1 : 0;
}

export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  if (!query.trim()) return items;
  return items
    .map((x) => ({ x, s: scoreCommand(x, query) }))
    .filter((o) => o.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((o) => o.x);
}

function Highlighted({ text, query }: { text: string; query: string }): ReactElement {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** Ctrl/Cmd + K. Typed text becomes an "Ask NutBot" first item when `onAsk` is given. */
export function CommandPalette({ open, onClose, items, onAsk }: { open: boolean; onClose: () => void; items: CommandItem[]; onAsk?: (text: string) => void }): ReactElement | null {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQuery(''); setSel(0); inputRef.current?.focus(); } }, [open]);

  const list = useMemo<CommandItem[]>(() => {
    const f = filterCommands(items, query);
    const raw = query.trim();
    return raw && onAsk ? [{ id: '__ask', group: 'NutBot', label: `Ask NutBot: “${raw}”`, icon: 'bot' as IconName, hint: 'Ctrl J', run: () => onAsk(raw) }, ...f] : f;
  }, [items, query, onAsk]);

  const run = (i: number) => { const x = list[i]; if (x) { onClose(); x.run(); } };
  if (!open) return null;
  let lastGroup = '';
  return (
    <>
      <div className="cmdk-bg" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-label="Search">
        <div className="cmdk-in">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to a page, game or action…"
            autoComplete="off"
            aria-label="Search pages, games and actions"
            onChange={(e) => { setQuery(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" role="listbox">
          {list.length ? list.map((x, i) => {
            const head = x.group !== lastGroup ? <span key={`g-${x.group}`} className="cmdk-g eyebrow">{x.group}</span> : null;
            lastGroup = x.group;
            return (
              <div key={x.id}>
                {head}
                <button type="button" role="option" aria-selected={i === sel} className={cx('cmdk-i', i === sel && 'on')} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
                  <Icon name={x.icon} />
                  <span><Highlighted text={x.label} query={x.id === '__ask' ? '' : query} /></span>
                  {x.hint ? <span className="k">{x.hint}</span> : null}
                </button>
              </div>
            );
          }) : <div className="cmdk-empty">Nothing matches “{query}”. Try a page name, a game or an action like “export”.</div>}
        </div>
        <div className="cmdk-foot">↑ ↓ to move · Enter to open · Esc to close</div>
      </div>
    </>
  );
}
