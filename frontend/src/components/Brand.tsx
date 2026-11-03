// FILE: src/components/Brand.tsx
export function Brand({ size = 28 }: { size?: number }) {
  // Pixel-art glyphs for "ONE"
  const glyphs = [
    // O
    ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    // N
    ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    // E
    ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  ];
  const totalW = glyphs.length * 18 - 3; // 3 glyphs × 18px cols, minus trailing gap
  const totalH = 23;
  return (
    <a
      className="wordmark"
      href="/dashboard"
      aria-label="One home"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label="ONE"
        style={{ width: size, height: size }}
      >
        {glyphs.flatMap((glyph, g) =>
          glyph.flatMap((row, y) =>
            [...row].map((pixel, x) =>
              pixel === "1" ? (
                <rect
                  key={`${g}-${y}-${x}`}
                  x={g * 18 + x * 3}
                  y={y * 3 + 1}
                  width="3"
                  height="3"
                />
              ) : null,
            ),
          ),
        )}
      </svg>
    </a>
  );
}
