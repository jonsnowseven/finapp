import { ImageResponse } from 'next/og';

// Generated favicon: gold "F" on black, matching the app's Black & Gold theme.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          borderRadius: 7,
          color: '#D4AF37',
          fontSize: 24,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        F
      </div>
    ),
    size,
  );
}
