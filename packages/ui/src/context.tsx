import { createContext, useContext, useState, type ReactNode, type ReactElement } from 'react';

type AppContextValue = { appEl: HTMLElement | null };
const AppContext = createContext<AppContextValue>({ appEl: null });

/** The element overlays (drawer, dialog, popovers) attach to, so they stay inside the app frame. */
export function useAppContainer(): HTMLElement | null {
  return useContext(AppContext).appEl;
}

export function AppContainerProvider({ appEl, children }: { appEl: HTMLElement | null; children: ReactNode }): ReactElement {
  return <AppContext.Provider value={{ appEl }}>{children}</AppContext.Provider>;
}

/** Ref callback + state pair for the element that hosts overlays. */
export function useAppElement(): [HTMLElement | null, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return [el, setEl];
}
