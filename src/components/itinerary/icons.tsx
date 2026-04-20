import type { SVGProps } from "react";

import type { TransportMode } from "@/types/domain";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconProps = Omit<SVGProps<SVGSVGElement>, "fill" | "stroke"> & {
  size?: number;
};

function Svg({
  size = 16,
  viewBox = "0 0 24 24",
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      aria-hidden
      {...base}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...props}>
      <path d="M19 12H5" />
      <path d="m11 19-7-7 7-7" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </Svg>
  );
}

export function ForkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2v8a3 3 0 0 0 6 0V2" />
      <path d="M10 10v12" />
      <path d="M17 2c-1.5 0-3 2-3 5v6h3" />
      <path d="M17 13v9" />
    </Svg>
  );
}

export function BedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 9V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4" />
      <path d="M2 11h20v8" />
      <path d="M2 19v-8" />
      <path d="M22 19H2" />
      <circle cx="9" cy="13.5" r="2" />
      <path d="M13 13h7" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2.2} {...props}>
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M5.64 5.64 7.76 7.76" />
      <path d="m16.24 16.24 2.12 2.12" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.64 18.36 7.76 16.24" />
      <path d="m16.24 7.76 2.12-2.12" />
    </Svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 22V4" />
      <path d="M4 15c5-3 9 3 14 0V4c-5 3-9-3-14 0" />
    </Svg>
  );
}

export function MapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0Z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </Svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
      <path d="M3 7h18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3Z" />
      <circle cx="16" cy="12" r="1.5" />
    </Svg>
  );
}

export function TripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 12h20" />
      <path d="m18 8 4 4-4 4" />
    </Svg>
  );
}

export function TransportIcon({
  mode,
  size = 18,
}: {
  mode: TransportMode;
  size?: number;
}) {
  if (mode === "flight") {
    return (
      <Svg size={size}>
        <path d="M17.8 19.2 16 11l3.5-3.5a2.5 2.5 0 0 0-3.6-3.6L12.5 7.5 4.3 5.7l-1.4 1.4 5.8 4.1-3.3 3.3H2l1 1.7 1.9.9.9 1.9 1.7 1h1.5l3.3-3.3 4.1 5.8z" />
      </Svg>
    );
  }
  if (mode === "train") {
    return (
      <Svg size={size}>
        <rect x="4" y="3" width="16" height="16" rx="2" />
        <path d="M4 11h16" />
        <path d="M7 20l2-2M17 20l-2-2" />
        <circle cx="9" cy="15" r="1" />
        <circle cx="15" cy="15" r="1" />
      </Svg>
    );
  }
  return (
    <Svg size={size}>
      <path d="M5 17h14" />
      <path d="M5 17V9l3-5h8l3 5v8" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="16" cy="17" r="2" />
    </Svg>
  );
}
