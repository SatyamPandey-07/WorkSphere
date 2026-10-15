import React from 'react';

export interface HardLightButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'wireframe' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const HardLightButton: React.FC<HardLightButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  disabled,
  ...props
}) => {
  // Size-dependent padding and typography
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-5 py-2.5 text-sm gap-2',
    lg: 'px-7 py-3.5 text-base gap-2.5',
  };

  // Variant color mappings with hard-light glowing energy themes
  const variantStyles = {
    primary:
      'bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold shadow-[0_0_20px_rgba(16,185,129,0.5)] hover:shadow-[0_0_30px_rgba(16,185,129,0.8)] border-emerald-400',
    wireframe:
      'bg-slate-950/80 hover:bg-emerald-950/40 text-emerald-300 font-bold border border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.25)] hover:shadow-[0_0_25px_rgba(16,185,129,0.6)] hover:border-emerald-400',
    danger:
      'bg-red-600 hover:bg-red-500 text-slate-950 font-extrabold shadow-[0_0_20px_rgba(239,68,68,0.5)] hover:shadow-[0_0_30px_rgba(239,68,68,0.8)] border-red-400',
  };

  // 45-degree chamfered corner bevel polygon mask
  const chamferClipPath =
    'polygon(12px 0%, calc(100% - 12px) 0%, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0% calc(100% - 12px), 0% 12px)';

  return (
    <button
      disabled={disabled}
      className={`relative inline-flex items-center justify-center font-mono uppercase tracking-wider transition-all duration-300 cursor-pointer select-none group overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed ${
        sizeStyles[size]
      } ${variantStyles[variant]} ${className}`}
      style={{
        clipPath: chamferClipPath,
      }}
      {...props}
    >
      {/* Animated Hard-Light Energy Hover Scanning Beam */}
      <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out pointer-events-none" />

      {/* Internal Content Slot */}
      <span className="relative z-10 flex items-center">{children}</span>
    </button>
  );
};

export default HardLightButton;
