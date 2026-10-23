import {
  Skeleton as AVNSkeleton,
  Button,
  Icon,
  useAppContainer,
} from "@avn/ui";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

export function Skeleton({
  w = "100%",
  h = 14,
  style,
}: {
  w?: CSSProperties["width"];
  h?: CSSProperties["height"];
  r?: number;
  style?: CSSProperties;
}) {
  return <AVNSkeleton width={w} height={h} style={style} />;
}
export function SkeletonRows({ rows = 5 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="kv" key={i}>
          <Skeleton w={`${28 + ((i * 17) % 22)}%`} />
          <Skeleton w={`${22 + ((i * 29) % 30)}%`} />
        </div>
      ))}
    </div>
  );
}
export function SkeletonLog({ rows = 9 }) {
  return (
    <div aria-busy="true" aria-label="Waiting for the first lines">
      {Array.from({ length: rows }, (_, i) => (
        <div className="log-row" key={i}>
          <Skeleton w={70} h={12} />
          <Skeleton w={35} h={12} />
          <Skeleton w={`${45 + ((i * 23) % 45)}%`} h={12} />
          <Skeleton w={90} h={12} />
        </div>
      ))}
    </div>
  );
}
export function LiveBars({
  label,
  paused = false,
}: {
  label: ReactNode;
  paused?: boolean;
}) {
  return (
    <span className={`tag ${paused ? "plain" : "ok"}`} role="status">
      {!paused && <span className="pl-live-dot" aria-hidden="true" />}
      {label}
    </span>
  );
}
export function Spinner() {
  return <span className="spinner sm" aria-hidden="true" />;
}
export function ActionButton({
  onClick,
  children,
  className = "btn",
  busyLabel,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Button
      {...rest}
      className={className}
      loading={busy}
      loadingLabel={busyLabel}
      onClick={async (e) => {
        if (busy) return;
        setBusy(true);
        try {
          await onClick?.(e);
        } finally {
          if (alive.current) setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
function remembered(id: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(`playlens.open.${id}`);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
export function Disclosure({
  id,
  title,
  hint,
  children,
  defaultOpen = false,
  tone,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  tone?: string;
}) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  const bodyId = useId();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`playlens.open.${id}`, open ? "0" : "1");
    } catch {
      /* private window */
    }
  };
  return (
    <section className="panel">
      <button
        className="ph pl-disclosure-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <Icon
          name="caret"
          style={{ transform: open ? undefined : "rotate(-90deg)" }}
        />
        <span className="pl-disclosure-title">
          <b>{title}</b>
          {hint && (
            <small className={tone === "warn" ? "warnc" : "muted"}>
              {hint}
            </small>
          )}
        </span>
        <span className="muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="pb pl-disclosure-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
export function Menu({
  items,
  label = "More",
}: {
  items: ({
    label: string;
    hidden?: boolean;
    href?: string | null;
    download?: boolean;
    danger?: boolean;
    pressed?: boolean;
    onClick?: () => unknown;
  } | null)[];
  label?: string;
}) {
  const container = useAppContainer();
  const shown = items.filter(
    (i): i is NonNullable<typeof i> => !!i && !i.hidden,
  );
  if (!shown.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="btn" aria-label={label} title={label}>
          <Icon name="more" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content
          className="pop pl-dropdown"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          loop
        >
          {shown.map((item) =>
            item.href ? (
              <DropdownMenu.Item asChild key={item.label}>
                <a
                  className="ni"
                  href={item.href}
                  download={item.download}
                  target={item.download ? undefined : "_blank"}
                  rel="noreferrer"
                >
                  {item.label}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                className={`ni${item.danger ? " badc" : ""}`}
                key={item.label}
                onSelect={item.onClick}
              >
                {item.pressed != null && (
                  <Icon
                    name="check"
                    style={{ opacity: item.pressed ? 1 : 0 }}
                  />
                )}
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
