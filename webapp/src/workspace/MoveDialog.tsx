import { Folder, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  type Key,
} from "react-aria-components";
import type { TreeNode } from "../api/workspaceTree";
import styles from "./dialog.module.css";

const topLevel = "top-level";

interface Destination {
  id: string;
  title: string;
  // The folder titles leading to it, for its accessible name.
  path: string;
  level: number;
}

// Every folder outside the moved item's subtree, in the tree's order.
function destinations(roots: TreeNode[], movedId: string): Destination[] {
  const found: Destination[] = [];
  const visit = (node: TreeNode, path: string[]) => {
    if (node.kind !== "folder" || node.id === movedId) return;
    const inside = [...path, node.title];
    found.push({
      id: node.id,
      title: node.title,
      path: inside.join(" / "),
      level: node.level,
    });
    for (const child of node.children) visit(child, inside);
  };
  for (const root of roots) visit(root, []);
  return found;
}

interface MoveDialogProps {
  node: TreeNode;
  roots: TreeNode[];
  // Called with the chosen folder, or null for the top level.
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}

// WCAG 2.5.7's single-pointer alternative to dragging an item into another
// folder or to the top level. The item goes last inside its destination;
// Move up and Move down then place it among its new siblings.
export function MoveDialog({ node, roots, onMove, onClose }: MoveDialogProps) {
  const folders = useMemo(() => destinations(roots, node.id), [roots, node]);
  const current = node.parentId ?? topLevel;
  const [chosen, setChosen] = useState<Key | null>(null);

  function confirm() {
    if (chosen === null) return;
    onMove(chosen === topLevel ? null : String(chosen));
    onClose();
  }

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {`Move “${node.title}”`}
          </Heading>
          <p className={styles.description}>
            {`Choose where to move the ${node.kind}. It goes last in the place you choose.`}
          </p>
          <ListBox
            aria-label="Destination"
            className={styles.destinations}
            selectionMode="single"
            selectedKeys={chosen === null ? [] : [chosen]}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              setChosen([...keys][0] ?? null);
            }}
            disabledKeys={[current]}
          >
            <ListBoxItem
              id={topLevel}
              textValue="Top level"
              className={styles.destination}
            >
              <Layers
                aria-hidden
                size={16}
                className={styles.destinationIcon}
              />
              <span className={styles.destinationTitle}>
                {current === topLevel ? "Top level (current)" : "Top level"}
              </span>
            </ListBoxItem>
            {folders.map((folder) => (
              <ListBoxItem
                key={folder.id}
                id={folder.id}
                textValue={folder.title}
                aria-label={
                  folder.id === current
                    ? `${folder.path} (current)`
                    : folder.path
                }
                className={styles.destination}
                style={{
                  paddingInlineStart: `calc(var(--space-2) + ${folder.level}rem)`,
                }}
              >
                <Folder
                  aria-hidden
                  size={16}
                  className={styles.destinationIcon}
                />
                <span className={styles.destinationTitle}>
                  {folder.id === current
                    ? `${folder.title} (current)`
                    : folder.title}
                </span>
              </ListBoxItem>
            ))}
          </ListBox>
          <div className={styles.buttons}>
            <Button slot="close" className={styles.button}>
              Cancel
            </Button>
            <Button
              className={`${styles.button} ${styles.confirm}`}
              isDisabled={chosen === null}
              onPress={confirm}
            >
              Move
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
