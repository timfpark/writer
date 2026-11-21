import {
  MutationObserver,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { client, type Document, type Folder } from "./client";
import {
  documentQueryOptions,
  isNotFound,
  read,
  send,
  workspaceQueryOptions,
} from "./queries";
import {
  applyChange,
  applyChanges,
  isTreeChange,
  subtreeIds,
  type TreeChange,
} from "./workspaceTree";

// ADR 0007's tree changes: one mutation key prefix and one scope, so the
// service receives them one at a time in the order the writer made them.
const mutationKey = ["workspace"];
const scope = { id: "workspace" };

async function perform(change: TreeChange): Promise<Folder | Document | null> {
  const { id } = change;
  if (change.type === "create") {
    const { parentId, beforeId, title } = change;
    if (change.kind === "folder") {
      return read(
        client.POST("/api/v1/folders", {
          body: { folderId: id, parentId, beforeId, title },
        }),
      );
    }
    const body =
      change.markdown === undefined
        ? { documentId: id, parentId, beforeId, title }
        : {
            documentId: id,
            parentId,
            beforeId,
            title,
            markdown: change.markdown,
          };
    return read(client.POST("/api/v1/documents", { body }));
  }
  if (change.type === "rename") {
    const body = { title: change.title };
    if (change.kind === "folder") {
      return read(
        client.PUT("/api/v1/folders/{folderId}/title", {
          params: { path: { folderId: id } },
          body,
        }),
      );
    }
    return read(
      client.PUT("/api/v1/documents/{documentId}/title", {
        params: { path: { documentId: id } },
        body,
      }),
    );
  }
  if (change.type === "move") {
    const body = { parentId: change.parentId, beforeId: change.beforeId };
    if (change.kind === "folder") {
      return read(
        client.PUT("/api/v1/folders/{folderId}/position", {
          params: { path: { folderId: id } },
          body,
        }),
      );
    }
    return read(
      client.PUT("/api/v1/documents/{documentId}/position", {
        params: { path: { documentId: id } },
        body,
      }),
    );
  }
  try {
    await send(
      change.kind === "folder"
        ? client.DELETE("/api/v1/folders/{folderId}", {
            params: { path: { folderId: id } },
          })
        : client.DELETE("/api/v1/documents/{documentId}", {
            params: { path: { documentId: id } },
          }),
    );
  } catch (error) {
    // An item that is already gone has been deleted, as ADR 0005 says.
    if (!isNotFound(error)) throw error;
  }
  return null;
}

// Applies a change the service accepted to the cached tree, so it does not
// flicker out before the next read, and to the cached document it names.
function settle(
  queryClient: QueryClient,
  change: TreeChange,
  result: Folder | Document | null,
) {
  const workspace = queryClient.getQueryData(workspaceQueryOptions.queryKey);
  if (change.type === "delete" && workspace) {
    for (const id of subtreeIds(workspace.items, change.id)) {
      queryClient.removeQueries({
        queryKey: documentQueryOptions(id).queryKey,
      });
    }
  }
  queryClient.setQueryData(workspaceQueryOptions.queryKey, (data) =>
    data ? { items: applyChange(data.items, change) } : data,
  );
  if (result && "revision" in result) {
    queryClient.setQueryData(documentQueryOptions(result.id).queryKey, result);
  }
}

function changeOptions(queryClient: QueryClient) {
  return {
    mutationKey,
    scope,
    mutationFn: perform,
    onSuccess: (result: Folder | Document | null, change: TreeChange) => {
      settle(queryClient, change, result);
    },
    onSettled: (_result: unknown, error: unknown) => {
      // A failure refetches the tree, the service's truth, and so does the
      // last pending change. This mutation still counts as pending here.
      if (error || queryClient.isMutating({ mutationKey }) === 1) {
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryOptions.queryKey,
        });
      }
    },
  };
}

// Returns a function that makes a tree change and resolves to whether the
// service accepted it. A failure is reported through useChangeFailures.
export function useWorkspaceChange(): (change: TreeChange) => Promise<boolean> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(changeOptions(queryClient));
  return useCallback(
    (change: TreeChange) =>
      mutateAsync(change).then(
        () => true,
        () => false,
      ),
    [mutateAsync],
  );
}

// Makes a tree change from outside a component, such as the save controller
// creating a conflict copy, in the same queue and with the same reporting
// as useWorkspaceChange. Resolves to the service's item, or rejects.
export function makeWorkspaceChange(
  queryClient: QueryClient,
  change: TreeChange,
): Promise<Folder | Document | null> {
  return new MutationObserver(queryClient, changeOptions(queryClient)).mutate(
    change,
  );
}

// The tree as the navigator shows it: the cached tree with every pending
// change applied over it, in order. Nothing is snapshotted or restored, so a
// failed change simply drops out and later pending changes stay applied.
export function useWorkspaceTree() {
  const query = useQuery(workspaceQueryOptions);
  const variables = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables,
  });
  const pending = useMemo(() => variables.filter(isTreeChange), [variables]);
  const items = useMemo(
    () => (query.data ? applyChanges(query.data.items, pending) : undefined),
    [query.data, pending],
  );
  return { query, items };
}

interface ChangeFailure {
  mutationId: number;
  change: TreeChange;
  error: unknown;
}

// Tree changes the service refused or never received, until dismissed.
export function useChangeFailures() {
  const queryClient = useQueryClient();
  const failed = useMutationState({
    filters: { mutationKey, status: "error" },
    select: (mutation) => mutation,
  });
  const failures = useMemo(
    () =>
      failed.flatMap(({ mutationId, state }): ChangeFailure[] =>
        isTreeChange(state.variables)
          ? [{ mutationId, change: state.variables, error: state.error }]
          : [],
      ),
    [failed],
  );
  const dismiss = useCallback(
    (mutationId: number) => {
      const cache = queryClient.getMutationCache();
      const mutation = cache
        .getAll()
        .find((candidate) => candidate.mutationId === mutationId);
      if (mutation) cache.remove(mutation);
    },
    [queryClient],
  );
  return { failures, dismiss };
}
