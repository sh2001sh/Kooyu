import { KooyuBrandMark } from "./KooyuBrand";

export interface MobiusLoaderProps {
  size?: number;
  className?: string;
  variant?: "compact" | "hero";
  label?: string;
}

/** Loading feedback preserves the approved ribbon instead of redrawing the brand. */
export function MobiusLoader({
  size = 24,
  className = "",
  variant = "compact",
  label = "正在思考并生成回复…",
}: MobiusLoaderProps) {
  return (
    <div
      className={`mobius-loader-wrap mobius-loader-wrap--${variant} ${className}`}
      role="status"
      aria-label={label}
      style={{ width: size, height: Math.round((size * 704) / 848) }}
    >
      <KooyuBrandMark size={size} className="mobius-loader-svg" />
    </div>
  );
}
