import { useLayoutEffect, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, stagger, useIsPresent } from 'motion/react';
import { useAnimate } from 'motion/react-mini';

const EASE = [0.2, 0.8, 0.2, 1];
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const readReducedMotion = () => window.matchMedia(MOTION_QUERY).matches;
const serverReducedMotion = () => true;
function subscribeReducedMotion(onChange) {
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Route identity excludes capture versions so live updates never replay an entrance. */
export function PageTransition({ pageKey, children }) {
  return <AnimatePresence mode="wait">
    <PageEntrance key={pageKey} pageKey={pageKey}>{children}</PageEntrance>
  </AnimatePresence>;
}

function PageEntrance({ pageKey, children }) {
  // Also finish immediately if the system preference changes mid-transition.
  const reduce = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, serverReducedMotion);
  const present = useIsPresent();
  const [scope, animate] = useAnimate();

  useLayoutEffect(() => {
    if (reduce) scope.current.getAnimations().forEach((animation) => animation.finish());
  }, [reduce, scope]);

  useLayoutEffect(() => {
    const root = scope.current;
    // Reset scroll after the outgoing page fades, before the new page paints.
    root.closest('.pl-scroll')?.scrollTo(0, 0);
    if (readReducedMotion()) return;

    // Animate only the blocks present on entry, never incoming log rows or data.
    const blocks = [...(root.querySelector('main.content')?.children ?? [])]
      .filter((el) => !el.matches('style, script, [hidden]'));
    if (!blocks.length) return;
    let active = true;
    const clear = () => blocks.forEach((el) => {
      el.style.removeProperty('opacity');
      el.style.removeProperty('transform');
    });
    blocks.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
    });
    const entrance = animate(blocks, { opacity: [0, 1], transform: ['translateY(10px)', 'none'] }, {
      duration: 0.28,
      ease: EASE,
      delay: stagger(0.05),
    });
    entrance.then(() => { if (active) clear(); });
    const stop = () => { active = false; entrance.stop(); clear(); };
    const unsubscribe = subscribeReducedMotion(() => { if (readReducedMotion()) stop(); });
    return () => { unsubscribe(); stop(); };
  }, [animate, scope]);

  return <motion.div
    ref={scope}
    className="data-page pl-page"
    data-page-key={pageKey}
    inert={!present}
    aria-hidden={!present || undefined}
    initial={reduce ? false : { opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: reduce ? 0 : 0.12, ease: EASE }}
  >{children}</motion.div>;
}
