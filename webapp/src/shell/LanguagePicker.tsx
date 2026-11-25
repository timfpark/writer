import { Check, ChevronDown, Globe } from "lucide-react";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  type Key,
} from "react-aria-components";
import { documentLanguages } from "../api/languages";
import { useWorkspaceChange } from "../api/workspaceChanges";
import styles from "./LanguagePicker.module.css";

interface LanguagePickerProps {
  documentId: string;
  language: string;
}

// Lets the writer pick the open document's language from the header, showing
// each language by its own name and updating the workspace optimistically.
export function LanguagePicker({ documentId, language }: LanguagePickerProps) {
  const change = useWorkspaceChange();

  function onChange(key: Key | null) {
    if (typeof key !== "string" || key === language) return;
    void change({
      type: "setLanguage",
      kind: "document",
      id: documentId,
      language: key,
    });
  }

  return (
    <Select
      className={styles.select}
      aria-label="Document language"
      value={language}
      onChange={onChange}
    >
      <Button className={styles.trigger}>
        <Globe aria-hidden size={14} className={styles.icon} />
        <SelectValue className={styles.value}>
          {({ defaultChildren }) => (
            <span lang={language}>{defaultChildren}</span>
          )}
        </SelectValue>
        <ChevronDown aria-hidden size={14} className={styles.icon} />
      </Button>
      <Popover className={styles.popover} placement="bottom start" offset={6}>
        <ListBox className={styles.list}>
          {documentLanguages.map((option) => (
            <ListBoxItem
              key={option.tag}
              id={option.tag}
              textValue={option.label}
              className={styles.option}
            >
              {({ isSelected }) => (
                <>
                  <span lang={option.tag}>{option.label}</span>
                  {isSelected ? (
                    <Check aria-hidden size={14} className={styles.check} />
                  ) : null}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
