import { QueryClient, useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        staleTime: 2000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { networkMode: "always", retry: 0 },
    },
  });
}
export const queryClient = createQueryClient();
export const resourceKey = (path: string) => ["api", path] as const;
export function useResource<T>(
  path: string,
  {
    enabled = true,
    interval = false,
  }: { enabled?: boolean; interval?: number | false } = {},
) {
  return useQuery({
    queryKey: resourceKey(path),
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled,
    refetchInterval: interval,
  });
}
export const refreshResource = (path: string) =>
  queryClient.invalidateQueries({ queryKey: resourceKey(path) });
