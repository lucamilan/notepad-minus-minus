import type { JSX } from 'preact';

type IconProps = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

function Icon({
  size = 16,
  children,
  ...rest
}: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function DeviceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11.5V14" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </Icon>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </Icon>
  );
}

export function ColumnsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M8 3v10" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Icon>
  );
}

export function SidebarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </Icon>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3.5h10M3 8h10M3 12.5h10" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 5v3l2 1.5" />
    </Icon>
  );
}

export function TaskIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 8.2l1.8 1.8 3.3-3.6" />
    </Icon>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5z" />
      <path d="M8 9v4.5" />
    </Icon>
  );
}

export function TagOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 2.5h5.5l5.5 5.5-5.5 5.5-5.5-5.5z" />
      <circle cx="5.5" cy="5.5" r=".8" fill="currentColor" />
    </Icon>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2.5h8v11l-4-3-4 3z" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Icon>
  );
}

/** "Chiudi le schede non fissate": una puntina che resta e una × per le altre. */
export function CloseUnpinnedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 2.5h3.5l-.4 3 2 2H1l2-2z" />
      <path d="M4.25 7.5v5" />
      <path d="M9.5 6.5l4 4M13.5 6.5l-4 4" />
    </Icon>
  );
}

/** Più schede impilate con una ×: "chiudi tutte". */
export function CloseAllIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 2.5h8a1 1 0 0 1 1 1v8" />
      <rect x="2.5" y="4.5" width="9" height="9" rx="1.5" />
      <path d="M5.5 7.5l3 3M8.5 7.5l-3 3" />
    </Icon>
  );
}

export function ZenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </Icon>
  );
}
