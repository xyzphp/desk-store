import { useId } from 'react';

export const BRAND_LOGO_DATA_URI =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22desk-g%22%20x1%3D%226%22%20y1%3D%228%22%20x2%3D%2257%22%20y2%3D%2256%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%233987F5%22%2F%3E%3Cstop%20offset%3D%22.55%22%20stop-color%3D%22%23535FDF%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%239865ED%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20d%3D%22M22%2021v-6a10%2010%200%200%201%2020%200v6%22%20fill%3D%22none%22%20stroke%3D%22url%28%23desk-g%29%22%20stroke-width%3D%225.5%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M13.5%2019h37a6%206%200%200%201%206%205.4l3%2027A7%207%200%200%201%2052.5%2059h-41a7%207%200%200%201-7-7.6l3-27a6%206%200%200%201%206-5.4Z%22%20fill%3D%22url%28%23desk-g%29%22%2F%3E%3Cpath%20d%3D%22m23%2031%2018%2018m0-18L23%2049%22%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%226.5%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E';

/** Desk Store 品牌标志：蓝紫渐变购物袋 + 白色 X 图形，适合 16px–96px 无外框缩放。 */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  const gradientId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="8" x2="57" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3987F5" />
          <stop offset=".55" stopColor="#535FDF" />
          <stop offset="1" stopColor="#9865ED" />
        </linearGradient>
      </defs>
      <path
        d="M22 21v-6a10 10 0 0 1 20 0v6"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M13.5 19h37a6 6 0 0 1 6 5.4l3 27A7 7 0 0 1 52.5 59h-41a7 7 0 0 1-7-7.6l3-27a6 6 0 0 1 6-5.4Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="m23 31 18 18m0-18L23 49"
        fill="none"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 首页首屏右侧轻量桌面应用窗口示意图，带浮动品牌徽标。 */
export function StoreHeroArt() {
  const bgGradId = useId();
  const cardGradId = useId();
  return (
    <svg className="store-hero-art" viewBox="0 0 440 270" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={bgGradId} x1="80" y1="20" x2="370" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b9c6ff" />
          <stop offset="1" stopColor="#8edbdc" />
        </linearGradient>
        <linearGradient id={cardGradId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#6598f8" />
          <stop offset="1" stopColor="#8061e7" />
        </linearGradient>
      </defs>
      <ellipse cx="230" cy="231" rx="157" ry="14" fill="#8394cf" opacity=".12" />
      <circle cx="231" cy="135" r="116" fill={`url(#${bgGradId})`} opacity=".22" />
      <circle cx="231" cy="135" r="138" stroke="#a9b8e2" strokeDasharray="4 8" opacity=".55" />
      <g transform="translate(82 37) rotate(-7 124 92)">
        <rect width="248" height="184" rx="18" fill="#c6d3fa" opacity=".78" />
        <rect x="9" y="8" width="230" height="168" rx="14" fill="#eef3ff" />
      </g>
      <g transform="translate(113 42)">
        <rect width="246" height="184" rx="19" fill="var(--store-art-window, #ffffff)" stroke="var(--store-art-stroke, #d8e1fa)" />
        <path d="M0 31h246" stroke="var(--store-art-divider, #e5e9f5)" />
        <circle cx="15" cy="16" r="3" fill="#b4bff0" />
        <circle cx="26" cy="16" r="3" fill="#d1d8ee" />
        <circle cx="37" cy="16" r="3" fill="#d1d8ee" />
        <rect x="62" y="11" width="123" height="10" rx="5" fill="var(--store-art-bar, #edf0f8)" />
        <g transform="translate(18 49)">
          <rect width="100" height="56" rx="11" fill="var(--store-art-tile-1, #f1f3ff)" />
          <rect x="10" y="11" width="29" height="29" rx="9" fill={`url(#${cardGradId})`} />
          <path d="M18 20h13m-13 5h13m-13 5h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <rect x="48" y="15" width="38" height="5" rx="2.5" fill="#9eace2" />
          <rect x="48" y="25" width="29" height="4" rx="2" fill="#ccd3ee" />

          <rect x="112" width="100" height="56" rx="11" fill="var(--store-art-tile-2, #eaf7f6)" />
          <rect x="122" y="11" width="29" height="29" rx="9" fill="#5db7bb" />
          <path d="M129 25h5l3-7 4 13 3-6h2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="160" y="15" width="38" height="5" rx="2.5" fill="#8fc2c7" />
          <rect x="160" y="25" width="30" height="4" rx="2" fill="#c1e0e0" />

          <rect y="66" width="100" height="56" rx="11" fill="var(--store-art-tile-3, #f6f0fb)" />
          <rect x="10" y="77" width="29" height="29" rx="9" fill="#9b79e5" />
          <path d="M18 85h13v13H18z" stroke="#fff" strokeWidth="2" />
          <rect x="48" y="81" width="38" height="5" rx="2.5" fill="#b7a3df" />
          <rect x="48" y="91" width="29" height="4" rx="2" fill="#ded4ed" />

          <rect x="112" y="66" width="100" height="56" rx="11" fill="var(--store-art-tile-4, #f0f4fc)" />
          <rect x="122" y="77" width="29" height="29" rx="9" fill="#6489ed" />
          <path d="m130 92 5 5 9-11" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="160" y="81" width="38" height="5" rx="2.5" fill="#9fafe0" />
          <rect x="160" y="91" width="29" height="4" rx="2" fill="#d0d9ed" />
        </g>
      </g>
      <g transform="translate(313 10) rotate(8 46 46)">
        <rect
          width="92"
          height="92"
          rx="24"
          fill="var(--store-art-badge, rgba(255, 255, 255, 0.9))"
          stroke="var(--store-art-stroke, #dbe3f8)"
        />
        <image href={BRAND_LOGO_DATA_URI} x="10" y="9" width="72" height="72" />
      </g>
    </svg>
  );
}
