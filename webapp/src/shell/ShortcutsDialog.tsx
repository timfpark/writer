import { Fragment } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import {
  isApplePlatform,
  keyLabel,
  navigatorKeys,
  paneKeys,
  pauseKeys,
  referenceKeys,
  type Keys,
} from "./shortcuts";
import styles from "./ShortcutsDialog.module.css";

// A shortcut's alternative key combinations, or words for input that is not
// a key, such as typing a title.
interface Shortcut {
  keys: (Keys | string)[];
  effect: string;
}

interface Group {
  title: string;
  shortcuts: Shortcut[];
}

function groups(apple: boolean): Group[] {
  const navigator = navigatorKeys(apple);
  return [
    {
      title: "Workspace",
      shortcuts: [
        { keys: [paneKeys.navigator], effect: "Show or hide the navigator" },
        { keys: [paneKeys.assistant], effect: "Show or hide the assistant" },
        {
          keys: [["F6"], ["Shift", "F6"]],
          effect: "Move focus to the next or previous pane",
        },
        { keys: [referenceKeys], effect: "Show these shortcuts" },
        {
          keys: [["Escape"]],
          effect: "Close a menu, a dialog, or a pane over the page",
        },
      ],
    },
    {
      title: "Navigator",
      shortcuts: [
        { keys: [["ArrowUp"], ["ArrowDown"]], effect: "Move between rows" },
        {
          keys: [["ArrowRight"], ["ArrowLeft"]],
          effect:
            "Expand or collapse a folder, or step through a row's buttons",
        },
        { keys: [["Home"], ["End"]], effect: "Go to the first or last row" },
        { keys: ["Type a title"], effect: "Go to the row with that title" },
        {
          keys: [["Enter"]],
          effect: "Open a document, or expand or collapse a folder",
        },
        { keys: [navigator.rename], effect: "Rename" },
        { keys: [navigator.delete], effect: "Delete, after asking" },
        {
          keys: [navigator.moveUp, navigator.moveDown],
          effect: "Move up or down among the items beside it",
        },
        {
          keys: [navigator.menu, ["ContextMenu"]],
          effect: "Open the row's menu to create inside it or move it",
        },
        {
          keys: [["Enter"], ["Escape"]],
          effect: "While renaming, keep or discard the new title",
        },
      ],
    },
    {
      title: "Writing",
      shortcuts: [
        {
          keys: [["Enter"]],
          effect: "Start a new line; twice, start a new paragraph",
        },
        {
          keys: [["Shift", "Enter"]],
          effect: "Start a new line anywhere but a heading",
        },
        {
          keys: [["ArrowLeft"], ["ArrowRight"]],
          effect: "Step across a shown formatting marker",
        },
        {
          keys: [["Backspace"], ["Delete"]],
          effect: "Into a shown marker, remove that formatting",
        },
        { keys: [["Mod", "S"]], effect: "Save at once" },
        { keys: [["Mod", "K"]], effect: "Add, change, or remove a link" },
        {
          keys: [
            ["Mod", "B"],
            ["Mod", "I"],
            ["Mod", "E"],
          ],
          effect: "Strong emphasis, emphasis, or code",
        },
        { keys: [["Mod", "Z"]], effect: "Undo" },
        {
          keys: [
            ["Mod", "Shift", "Z"],
            ["Mod", "Y"],
          ],
          effect: "Redo",
        },
        {
          keys: [["Tab"], ["Shift", "Tab"]],
          effect: "Nest or unnest a list item",
        },
      ],
    },
    {
      title: "Assistant",
      shortcuts: [
        {
          keys: [pauseKeys],
          effect: "Pause or resume background review",
        },
        {
          keys: [["F8"], ["Shift", "F8"]],
          effect: "Move to the next or previous finding",
        },
        { keys: [["Enter"]], effect: "Send the message" },
        { keys: [["Shift", "Enter"]], effect: "Start a new line" },
      ],
    },
  ];
}

// Every keyboard shortcut in the workspace, opened from the header or with
// Mod+/.
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const apple = isApplePlatform();
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
          <Heading slot="title" level={2} className={styles.title}>
            Keyboard shortcuts
          </Heading>
          <div className={styles.groups}>
            {groups(apple).map((group) => (
              <section key={group.title} className={styles.group}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                <dl className={styles.list}>
                  {group.shortcuts.map((shortcut) => (
                    <div key={shortcut.effect} className={styles.item}>
                      <dt className={styles.keys}>
                        {shortcut.keys.map((keys, index) => (
                          <Fragment key={index}>
                            {index > 0 ? " " : null}
                            {typeof keys === "string" ? (
                              keys
                            ) : (
                              <kbd className={styles.key}>
                                {keyLabel(keys, apple)}
                              </kbd>
                            )}
                          </Fragment>
                        ))}
                      </dt>
                      <dd className={styles.effect}>{shortcut.effect}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <div className={styles.buttons}>
            <Button slot="close" className={styles.button}>
              Close
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
