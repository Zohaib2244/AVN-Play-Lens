import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { App } from "./App";
import { validateSearch } from "./navigation";
import { AppProvider } from "./state";

const rootRoute = createRootRoute({
  validateSearch,
  component: () => (
    <AppProvider>
      <App />
    </AppProvider>
  ),
});
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
