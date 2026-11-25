import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { defaultLanguage } from "../api/languages";
import {
  documentContentQueryOptions,
  documentQueryOptions,
  isDocumentId,
  isNotFound,
} from "../api/queries";
import { useQueryFailure } from "../api/useQueryFailure";
import { useWorkspaceTree } from "../api/workspaceChanges";
import { useSaveManager, type SaveManager } from "../saving/saveManager";
import { ServiceUnavailable } from "./ServiceUnavailable";
import { PageMessage, WritingPage } from "./WritingPage";

export function EmptyWorkspace() {
  return (
    <PageMessage title="No document is open">
      Choose a document in the navigator to start writing.
    </PageMessage>
  );
}

export function NotFoundView() {
  return (
    <PageMessage title="This page does not exist">
      <Link to="/">Go to the workspace</Link>
    </PageMessage>
  );
}

// The editor, its extensions, and the Markdown bridge load as their own
// chunk when a document first opens, as ADR 0008's bundle budget requires.
const loadEditor = () => import("../editor/DocumentEditor");
const DocumentEditor = lazy(loadEditor);

// Whether text an earlier page left for the document has been saved, or
// recovery has stopped on a problem, so its content can be read.
function useRecovered(manager: SaveManager, documentId: string): boolean {
  const [recovered, setRecovered] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void manager.whenRecovered(documentId).then(() => {
      if (current) setRecovered(documentId);
    });
    return () => {
      current = false;
    };
  }, [manager, documentId]);
  return recovered === documentId;
}

function Loading() {
  return <div aria-busy="true" />;
}

// The open document in the writing region. Its content is read from the
// service each time it opens, after any text an earlier page left for it has
// been saved, and the editor owns the text from then on.
export function DocumentView({ documentId }: { documentId: string }) {
  const manager = useSaveManager();
  const recovered = useRecovered(manager, documentId);
  const { items } = useWorkspaceTree();
  const document = useQuery(documentQueryOptions(documentId));
  const language =
    items?.find((item) => item.id === documentId)?.language ??
    document.data?.language ??
    defaultLanguage;
  const content = useQuery({
    ...documentContentQueryOptions(documentId),
    enabled: isDocumentId(documentId) && recovered,
  });
  const documentFailure = useQueryFailure(document);
  const contentFailure = useQueryFailure(content);
  const failure = documentFailure ?? contentFailure;
  const navigate = useNavigate();

  // The editor's chunk loads while the content is read.
  useEffect(() => {
    void loadEditor();
  }, []);

  // A document deleted elsewhere is recreated holding the writer's text,
  // which then opens in its place.
  useEffect(
    () =>
      manager.onReplaced((from, to) => {
        if (from !== documentId) return;
        void navigate({
          to: "/documents/$documentId",
          params: { documentId: to },
          replace: true,
        });
      }),
    [manager, documentId, navigate],
  );

  if (!isDocumentId(documentId) || isNotFound(failure)) {
    return (
      <PageMessage title="This document does not exist">
        It may have been deleted. <Link to="/">Go to the workspace</Link>
      </PageMessage>
    );
  }
  if (failure) {
    return (
      <ServiceUnavailable
        error={failure}
        onRetry={() => {
          void document.refetch();
          void content.refetch();
        }}
      />
    );
  }
  return (
    <WritingPage>
      {content.data && recovered ? (
        <Suspense fallback={<Loading />}>
          <DocumentEditor
            key={documentId}
            documentId={documentId}
            language={language}
            content={content.data}
            manager={manager}
          />
        </Suspense>
      ) : (
        <Loading />
      )}
    </WritingPage>
  );
}
