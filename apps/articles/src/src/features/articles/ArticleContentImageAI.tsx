import { useId, useRef } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import type { FormAIIdentity } from '../../shared/ai/formAI';
import type { ArticleFile } from './api';
import { articleImageAvailable } from './articleImageAI';
import { ArticleContentImagePanel } from './ArticleContentImagePanel';
import {
  useArticleContentImageAI,
  type ArticleContentImageSelection,
  type ArticleContentImageUse,
} from './useArticleContentImageAI';
import { articleMessages } from './locale';

export function ArticleContentImageAI({
  active,
  identity,
  fields,
  selection,
  onUseFile,
  onStatus,
  onBusyChange,
  uploadFile,
}: {
  active: boolean;
  identity: FormAIIdentity;
  fields: Readonly<Record<string, string>>;
  selection: () => ArticleContentImageSelection;
  onUseFile: (
    file: ArticleFile,
    selection: ArticleContentImageSelection,
    use: ArticleContentImageUse,
  ) => boolean | Promise<boolean>;
  onStatus: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  uploadFile: (file: File) => Promise<ArticleFile | undefined>;
}) {
  const t = useMessages(articleMessages);
  const anchor = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const imageAI = useArticleContentImageAI({
    active,
    identity,
    fields,
    onUseFile,
    onStatus,
    onBusyChange,
    uploadFile,
  });
  const available = articleImageAvailable(imageAI.capability);
  if (!available) return null;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="workspace-button ai-assist-entry"
        data-ai-editor-mode="image"
        aria-label={t.contentImage.entry}
        title={t.contentImage.entry}
        aria-haspopup="dialog"
        aria-expanded={imageAI.open}
        aria-controls={imageAI.open ? dialogId : undefined}
        disabled={!active || imageAI.busy}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (imageAI.open) imageAI.close();
          else void imageAI.show(selection());
        }}
      >
        <Icon className="xyz-icon" name="image-plus" aria-hidden="true" />
        <span>{t.contentImage.entry}</span>
      </button>
      <ArticleContentImagePanel ai={imageAI} anchor={anchor} dialogId={dialogId} fields={fields} />
    </>
  );
}
