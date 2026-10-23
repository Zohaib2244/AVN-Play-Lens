// The home screen's pixel-art desk at night. Pure SVG, animated with CSS.
const R = ({ x, y, w, h, f, c, d }) => <rect x={x} y={y} width={w} height={h} fill={f} className={c} style={d ? { animationDelay: d } : undefined} />;

const stars = [[20, 18, 0], [31, 25, .8], [45, 16, 1.6], [63, 22, .4], [90, 31, 2.2], [26, 33, 1.2], [69, 31, 2.8]];
const city = [[12, 52, 10, 14], [22, 47, 8, 19], [30, 55, 12, 11], [42, 45, 9, 21], [51, 51, 13, 15], [64, 43, 9, 23], [73, 53, 11, 13], [84, 48, 12, 18]];
const lit = [[16, 56], [25, 51], [45, 49], [47, 54], [67, 47], [69, 52], [89, 53], [56, 55]];

export function PixelScene({ caption, ready }) {
  return (
    <div className="panel rise" style={{ flex: '1 1 480px', maxWidth: 560, overflow: 'hidden', padding: 0, animationDelay: '.1s' }}>
      <svg viewBox="0 0 160 110" width="100%" style={{ display: 'block' }} shapeRendering="crispEdges" role="img" aria-label="Pixel art of a cozy desk at night with a phone on a stand">
        <defs>
          <pattern id="dith" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#2A3060" /><rect x="1" y="1" width="1" height="1" fill="#2A3060" /></pattern>
        </defs>
        <R x={0} y={0} w={160} h={110} f="#221B17" />
        <R x={8} y={8} w={92} h={62} f="#3A2F27" />
        <R x={12} y={12} w={84} h={54} f="#1D2140" />
        <rect x="12" y="40" width="84" height="8" fill="url(#dith)" />
        <R x={12} y={48} w={84} h={18} f="#2A3060" />
        <R x={77} y={17} w={8} h={8} f="#F6E7B8" /><R x={82} y={17} w={3} h={4} f="#1D2140" />
        {stars.map(([x, y, d]) => <R key={`${x}-${y}`} x={x} y={y} w={1} h={1} f="#F1E7D6" c="twinkle" d={`${d}s`} />)}
        {city.map(([x, y, w, h]) => <R key={`c${x}`} x={x} y={y} w={w} h={h} f="#12152B" />)}
        {lit.map(([x, y]) => <R key={`l${x}-${y}`} x={x} y={y} w={1} h={1} f="#F4A261" />)}
        <R x={53} y={12} w={2} h={54} f="#3A2F27" /><R x={12} y={38} w={84} h={2} f="#3A2F27" />
        <R x={6} y={70} w={96} h={3} f="#4A3C31" />
        <polygon points="114,56 130,56 150,88 94,88" fill="#F6A57A" opacity=".09" />
        <R x={0} y={88} w={160} h={4} f="#5A4636" /><R x={0} y={92} w={160} h={18} f="#3A2C22" />
        <R x={8} y={80} w={16} h={3} f="#7A5C8A" /><R x={9} y={83} w={15} h={3} f="#4F7A73" /><R x={7} y={86} w={17} h={2} f="#B5674F" />
        <R x={28} y={76} w={12} h={12} f="#C9705A" /><R x={28} y={76} w={12} h={2} f="#D98A73" />
        <R x={40} y={79} w={3} h={6} f="#C9705A" /><R x={40} y={81} w={1} h={2} f="#221B17" />
        <R x={31} y={68} w={1} h={4} f="#BDAE98" c="steam" /><R x={34} y={66} w={1} h={4} f="#BDAE98" c="steam" d=".9s" /><R x={37} y={69} w={1} h={4} f="#BDAE98" c="steam" d="1.7s" />
        <R x={52} y={78} w={12} h={10} f="#8A5A44" /><R x={51} y={78} w={14} h={2} f="#9C6A52" />
        <R x={54} y={70} w={3} h={8} f="#6FA36B" /><R x={58} y={65} w={3} h={13} f="#7DB477" /><R x={61} y={71} w={3} h={7} f="#6FA36B" />
        <R x={51} y={72} w={4} h={2} f="#6FA36B" /><R x={62} y={68} w={4} h={2} f="#7DB477" />
        <R x={70} y={78} w={22} h={10} f="#4A3C31" />
        {[80, 83, 86, 89].map((x, i) => <R key={`eq${x}`} x={x} y={80} w={2} h={6} f="#F6A57A" c="eq" d={`${[0, .25, .5, .12][i]}s`} />)}
        <R x={128} y={84} w={14} h={4} f="#6B5546" /><R x={134} y={56} w={2} h={28} f="#6B5546" /><R x={122} y={54} w={14} h={2} f="#6B5546" />
        <R x={114} y={50} w={14} h={2} f="#F6A57A" /><R x={112} y={52} w={18} h={4} f="#F6A57A" />
        <R x={98} y={84} w={24} h={4} f="#4A3C31" />
        <R x={101} y={57} w={18} h={29} f="#0F0D0B" />
        <R x={103} y={60} w={14} h={22} f={ready ? '#84C9B9' : '#3A2F27'} />
        {ready && (
          <>
            <R x={105} y={69} w={4} h={4} f="#F28B82" /><R x={109} y={73} w={4} h={4} f="#F6A57A" /><R x={105} y={73} w={4} h={4} f="#EBC86A" />
            <R x={113} y={73} w={3} h={4} f="#B7A7E8" /><R x={109} y={77} w={4} h={4} f="#F1E7D6" /><R x={105} y={62} w={10} h={2} f="#2E5E54" />
            <R x={105} y={49} w={10} h={1} f="#F6A57A" c="blinkw" /><R x={107} y={51} w={6} h={1} f="#F6A57A" c="blinkw" d=".2s" /><R x={109} y={53} w={2} h={1} f="#F6A57A" c="blinkw" d=".4s" />
          </>
        )}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
        <span className="mono dim" style={{ fontSize: 12.5 }}>{caption}</span>
        {ready ? <span className="tag tag-ok">Ready for Unity</span> : <span className="tag tag-plain">Waiting for a phone</span>}
      </div>
    </div>
  );
}
