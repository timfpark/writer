import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { WorkspaceShell } from "./shell/WorkspaceShell";
import { DocumentView, EmptyWorkspace, NotFoundView } from "./workspace/views";

// ADR 0007's code-based route tree: the workspace at /, an open document at
// /documents/$documentId, and a not-found message for any other path.
interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: WorkspaceShell,
  notFoundComponent: NotFoundView,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: EmptyWorkspace,
});

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: function DocumentRoute() {
    const { documentId } = documentRoute.useParams();
    return <DocumentView documentId={documentId} />;
  },
});

const routeTree = rootRoute.addChildren([workspaceRoute, documentRoute]);

export function createAppRouter(
  queryClient: QueryClient,
  history?: RouterHistory,
) {
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
