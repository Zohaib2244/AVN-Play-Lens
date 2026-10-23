import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { validateSearch } from "./navigation";
/** Filter edits replace history; page navigation pushes history. URLs reopen the same view. */
export function useViewState(
  key: string,
  fallback: string,
): [string, Dispatch<SetStateAction<string>>];
export function useViewState(
  key: string,
  fallback: number,
): [number, Dispatch<SetStateAction<number>>];
export function useViewState(
  key: string,
  fallback: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>];
export function useViewState<T extends string | number | boolean>(
  key: string,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>];
export function useViewState<T extends string | number | boolean>(
  key: string,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const raw = search[key];
  const value = (typeof raw === typeof fallback ? raw : fallback) as T;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    void navigate({
      to: "/",
      replace: true,
      resetScroll: false,
      search: (old) => {
        const current = (
          typeof old[key] === typeof fallback ? old[key] : fallback
        ) as T;
        const result = typeof next === "function" ? next(current) : next;
        return {
          ...validateSearch(old),
          [key]: result === fallback ? undefined : result,
        };
      },
    });
  };
  return [value, set];
}

/** Keep existing personal defaults, but write the effective value into copied links. */
export function useViewPreference<T extends string | boolean>(
  key: string,
  storageKey: string,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
  const search = useSearch({ from: "__root__" }),
    navigate = useNavigate();
  const [initial] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === null) return fallback;
      return (
        typeof fallback === "boolean"
          ? saved === "1" || saved === "true"
          : saved
      ) as T;
    } catch {
      return fallback;
    }
  });
  const raw = search[key];
  const value = (typeof raw === typeof fallback ? raw : initial) as T;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    void navigate({
      to: "/",
      replace: true,
      resetScroll: false,
      search: (old) => {
        const previous = (
          typeof old[key] === typeof fallback ? old[key] : initial
        ) as T;
        const result = typeof next === "function" ? next(previous) : next;
        try {
          localStorage.setItem(
            storageKey,
            typeof result === "boolean" ? (result ? "1" : "0") : result,
          );
        } catch {
          /* private window */
        }
        return { ...validateSearch(old), [key]: result };
      },
    });
  };
  useEffect(() => {
    if (search[key] === undefined)
      void navigate({
        to: "/",
        replace: true,
        resetScroll: false,
        search: (old) => ({
          ...validateSearch(old),
          [key]: old[key] ?? initial,
        }),
      });
  }, [key, initial, navigate, search[key]]);
  return [value, set];
}
