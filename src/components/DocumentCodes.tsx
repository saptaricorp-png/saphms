import React, { useEffect, useState } from 'react';
import { encodeCode39Bars, generateQrSvgString } from '../utils/codes';

export function BarcodeSvg({
  value,
  height = 34,
  width = 148,
  showText = true,
  className = '',
}: {
  value: string;
  height?: number;
  width?: number;
  showText?: boolean;
  className?: string;
}) {
  const { bars, totalWidth, cleanText } = encodeCode39Bars(value);

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${totalWidth} 32`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Barcode ${cleanText}`}
      >
        <rect x="0" y="0" width={totalWidth} height="32" fill="#ffffff" />
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={1} width={b.w} height={30} fill="#0f172a" />
        ))}
      </svg>
      {showText && (
        <span className="text-[9px] font-mono font-semibold tracking-widest text-slate-700 leading-none mt-0.5">
          {cleanText}
        </span>
      )}
    </div>
  );
}

export function QrCodeSvg({
  value,
  size = 64,
  className = '',
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [svgMarkup, setSvgMarkup] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void generateQrSvgString(value, size).then((markup) => {
      if (!cancelled) setSvgMarkup(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!svgMarkup) {
    return (
      <div
        className={`bg-white border border-slate-200 flex items-center justify-center text-[8px] font-mono text-slate-400 ${className}`}
        style={{ width: size, height: size }}
      >
        QR
      </div>
    );
  }

  return (
    <div
      className={`inline-block bg-white border border-slate-200 p-0.5 leading-none ${className}`}
      style={{ width: size + 4, height: size + 4 }}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
