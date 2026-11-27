import { useEffect, useRef } from 'react';

export function usePublicArticleTagCloud(contentKey: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cloud = ref.current;
    const frameWindow = cloud?.ownerDocument.defaultView;
    if (!cloud || !frameWindow) return;
    const motion = frameWindow.matchMedia('(prefers-reduced-motion: reduce)');
    const links = Array.from(cloud.querySelectorAll<HTMLAnchorElement>('a'));
    const points = links.map((node, index) => {
      const phi = Math.acos(-1 + (2 * (index + 1) - 1) / links.length);
      const theta = Math.sqrt(links.length * Math.PI) * phi;
      return { node, x: Math.cos(theta) * Math.sin(phi), y: Math.sin(theta) * Math.sin(phi), z: Math.cos(phi) };
    });
    let frame = 0;
    let stopped = false;
    let hovering = false;
    let focused = false;
    let last = 0;
    const orbiting = () => !motion.matches && links.length >= 4 && links.length <= 24;
    const draw = () => {
      const radius = Math.min(110, (cloud.clientWidth - 70) / 2);
      points.forEach((point) => {
        const maxX = Math.max(4, cloud.clientWidth - point.node.offsetWidth - 4);
        point.node.style.left = `${Math.max(4, Math.min(maxX, cloud.clientWidth / 2 + point.x * radius - point.node.offsetWidth / 2))}px`;
        point.node.style.top = `${cloud.clientHeight / 2 + point.y * radius - point.node.offsetHeight / 2}px`;
        point.node.style.opacity = hovering || focused ? '1' : String(0.55 + (0.45 * (1 - point.z)) / 2);
        point.node.style.zIndex = String(Math.round(100 - point.z * 50));
      });
    };
    const tick = (time: number) => {
      if (stopped || cloud.ownerDocument.hidden || hovering || focused || !orbiting()) {
        frame = 0;
        return;
      }
      const delta = Math.min(40, time - (last || time));
      last = time;
      const yAngle = delta * 0.00015;
      const xAngle = delta * 0.00022;
      points.forEach((point) => {
        const y = point.y * Math.cos(yAngle) - point.z * Math.sin(yAngle);
        const z = point.y * Math.sin(yAngle) + point.z * Math.cos(yAngle);
        const x = point.x;
        point.x = x * Math.cos(xAngle) + z * Math.sin(xAngle);
        point.z = -x * Math.sin(xAngle) + z * Math.cos(xAngle);
        point.y = y;
      });
      draw();
      frame = frameWindow.requestAnimationFrame(tick);
    };
    const update = () => {
      frameWindow.cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      cloud.classList.toggle('is-orbiting', orbiting());
      if (!orbiting()) {
        points.forEach((point) => point.node.removeAttribute('style'));
        return;
      }
      draw();
      if (!cloud.ownerDocument.hidden && !hovering && !focused) frame = frameWindow.requestAnimationFrame(tick);
    };
    const enter = () => {
      hovering = true;
      update();
    };
    const leave = () => {
      hovering = false;
      update();
    };
    const focusIn = () => {
      focused = true;
      update();
    };
    const focusOut = (event: FocusEvent) => {
      focused = !!event.relatedTarget && cloud.contains(event.relatedTarget as Node);
      update();
    };
    const visibility = () => update();
    const observer = frameWindow.ResizeObserver
      ? new frameWindow.ResizeObserver(() => {
          if (orbiting()) draw();
        })
      : undefined;
    cloud.addEventListener('pointerenter', enter);
    cloud.addEventListener('pointerleave', leave);
    cloud.addEventListener('focusin', focusIn);
    cloud.addEventListener('focusout', focusOut);
    cloud.ownerDocument.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', update);
    observer?.observe(cloud);
    update();
    return () => {
      stopped = true;
      frameWindow.cancelAnimationFrame(frame);
      observer?.disconnect();
      cloud.removeEventListener('pointerenter', enter);
      cloud.removeEventListener('pointerleave', leave);
      cloud.removeEventListener('focusin', focusIn);
      cloud.removeEventListener('focusout', focusOut);
      cloud.ownerDocument.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', update);
      cloud.classList.remove('is-orbiting');
      points.forEach((point) => point.node.removeAttribute('style'));
    };
  }, [contentKey]);

  return ref;
}
