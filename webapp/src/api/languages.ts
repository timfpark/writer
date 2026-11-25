export interface DocumentLanguage {
  readonly tag: string;
  // Each language's own name (endonym), shown in the picker.
  readonly label: string;
}

export const defaultLanguage = "en";

export const documentLanguages: readonly DocumentLanguage[] = [
  { tag: "en", label: "English" },
  { tag: "es", label: "Español" },
];
