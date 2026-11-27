import { useEffect, useRef } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import { articleMessages } from './locale';

const barrageColors = ['#61dafb', '#ffb86c', '#50fa7b', '#ff79c6', '#f1fa8c', '#bd93f9', '#fff'];

export function PublicArticleBarrageDialog({
  quotes,
  loading,
  frameWindow,
  onClose,
}: {
  quotes: readonly string[];
  loading: boolean;
  frameWindow: Window;
  onClose: () => void;
}) {
  const t = useMessages(articleMessages);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const dialog = dialogRef.current;
    const stage = dialog?.querySelector('.reader-barrage-stage');
    if (!dialog?.open || !stage) return;
    const nodes = Array.from(stage.querySelectorAll('span'));
    const rows = Math.max(1, Math.floor(stage.clientHeight / 44));
    const animations: Animation[] = [];
    let timeout = 0;
    let end = 0;
    nodes.forEach((node, index) => {
      const duration = 6000 + (index % 7) * 1000;
      const delay = Math.floor(index / rows) * 2400;
      node.style.top = `${(index % rows) * 44}px`;
      node.style.color = barrageColors[index % barrageColors.length] ?? '#fff';
      if (typeof node.animate === 'function') {
        animations.push(
          node.animate(
            [{ transform: `translateX(${stage.clientWidth}px)` }, { transform: `translateX(-${node.clientWidth}px)` }],
            { duration, delay, fill: 'both', easing: 'linear' },
          ),
        );
      }
      end = Math.max(end, duration + delay);
    });
    timeout = frameWindow.setTimeout(onClose, nodes.length ? end : 6000);
    return () => {
      frameWindow.clearTimeout(timeout);
      animations.forEach((animation) => animation.cancel());
    };
  }, [frameWindow, loading, onClose, quotes]);

  const phrases = quotes.slice(0, 30);
  return (
    <dialog
      ref={dialogRef}
      className="reader-barrage"
      aria-label={t.public.barrageAria}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button className="reader-barrage-close" type="button" aria-label={t.public.closeBarrage} onClick={onClose}>
        ×
      </button>
      <div className="reader-barrage-stage" aria-hidden="true">
        {loading ? (
          <p className="reader-barrage-empty">{t.public.barrageLoading}</p>
        ) : phrases.length ? (
          phrases.map((text, index) => <span key={`${index}-${text}`}>{text}</span>)
        ) : (
          <p className="reader-barrage-empty">{t.public.barrageEmpty}</p>
        )}
      </div>
    </dialog>
  );
}

export function PublicArticleImageDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useMessages(articleMessages);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="reader-image-modal"
      aria-label={t.public.imagePreviewAria(alt)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" aria-label={t.public.closeImage} onClick={onClose}>
        ×
      </button>
      <img src={src} alt={alt} />
    </dialog>
  );
}
