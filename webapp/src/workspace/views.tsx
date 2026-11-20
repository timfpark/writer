import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { documentQueryOptions, isDocumentId, isNotFound } from "../api/queries";
import { useQueryFailure } from "../api/useQueryFailure";
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

// The open document's place in the writing region. Backlog 23 puts the
// editor here.
export function DocumentView({ documentId }: { documentId: string }) {
  const document = useQuery(documentQueryOptions(documentId));
  const failure = useQueryFailure(document);

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
        onRetry={() => void document.refetch()}
      />
    );
  }
  return (
    <WritingPage>
      <div aria-busy={document.isPending} />
    </WritingPage>
  );
}
