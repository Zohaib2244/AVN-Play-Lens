// The game to look at, shared by every page. "Follow the open app" tracks whichever installed
// game is in front on the phone; picking one by hand pins it. The list comes from the app state,
// which keeps polling, so a build you just installed shows up without reloading.
import { useApp } from '../state.jsx';

export function GamePicker({ className = 'select', id, ...rest }) {
  const { device, serial, pkg, setPkg, follow, setFollow, apps, refreshApps } = useApp();
  if (!device) return null;
  const installed = apps.serial === serial ? apps.packages : [];
  const open = apps.serial === serial ? apps.foreground : null;
  const options = pkg && !installed.includes(pkg) && !device.replay ? [pkg, ...installed] : installed;
  const others = options.filter((p) => p !== open);
  const pick = (v) => {
    if (v === '__follow') return setFollow(true);
    setFollow(false);
    setPkg(v || null);
  };
  return (
    <select
      id={id}
      className={className}
      value={follow && !device.replay ? '__follow' : pkg || ''}
      onChange={(e) => pick(e.target.value)}
      onMouseDown={refreshApps}
      onFocus={refreshApps}
      aria-label="Game"
      {...rest}
    >
      {!device.replay && <option value="__follow">Follow the open app{follow && pkg ? ` · ${pkg}` : ''}</option>}
      <option value="">Everything on the device</option>
      {device.replay && pkg && <option value={pkg}>{pkg}</option>}
      {open && options.includes(open) && <optgroup label="Open on the phone now"><option value={open}>{open}</option></optgroup>}
      {!device.replay && others.length > 0 && <optgroup label="Installed games and apps">{others.map((p) => <option key={p} value={p}>{p}</option>)}</optgroup>}
    </select>
  );
}
