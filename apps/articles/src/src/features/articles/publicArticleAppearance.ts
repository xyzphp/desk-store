import { createContext, useContext } from 'react';
import type { ThemeChoice } from '@xyzos/desk-ui';
import { articleText } from './locale';

export interface PublicArticleAppearance {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}

export const PublicArticleAppearanceContext = createContext<PublicArticleAppearance | null>(null);

export function usePublicArticleAppearance() {
  const context = useContext(PublicArticleAppearanceContext);
  if (!context) throw new Error(articleText().public.appearanceMissing);
  return context;
}
