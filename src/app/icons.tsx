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

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5v.01" />
    </Icon>
  );
}
