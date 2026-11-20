import type { ReactNode } from "react";
import styles from "./WritingPage.module.css";

export function WritingPage({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

interface PageMessageProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert";
}

// A message set on the writing page in place of a document.
export function PageMessage({
  title,
  children,
  action,
  role,
}: PageMessageProps) {
  return (
    <WritingPage>
      <section className={styles.message} {...(role ? { role } : {})}>
        <h2 className={styles.messageTitle}>{title}</h2>
        {children ? <p className={styles.messageBody}>{children}</p> : null}
        {action}
      </section>
    </WritingPage>
  );
}

export const actionClassName = styles.action;
