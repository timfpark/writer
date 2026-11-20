import { Button } from "react-aria-components";
import { ServiceError } from "../api/queries";
import { actionClassName, PageMessage } from "./WritingPage";

interface ServiceUnavailableProps {
  error: unknown;
  onRetry: () => void;
}

// Shown in the writing region when the service cannot answer.
export function ServiceUnavailable({
  error,
  onRetry,
}: ServiceUnavailableProps) {
  const problem = error instanceof ServiceError ? error.problem : undefined;
  const httpStatus =
    error instanceof ServiceError ? error.httpStatus : undefined;
  const retry = (
    <Button className={actionClassName} onPress={onRetry}>
      Try again
    </Button>
  );

  if (problem) {
    return (
      <PageMessage
        title="The service reported a problem"
        action={retry}
        role="alert"
      >
        {`${problem.detail} (HTTP ${problem.status})`}
      </PageMessage>
    );
  }
  return (
    <PageMessage
      title="Writer can't reach the service"
      action={retry}
      role="alert"
    >
      {`Start the service, then try again.${httpStatus === undefined ? "" : ` The request ended with HTTP ${httpStatus}.`}`}
    </PageMessage>
  );
}
