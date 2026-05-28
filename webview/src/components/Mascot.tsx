// Пиксельная акула, ручная разметка 32×20. Узнаваемый силуэт: острая морда, треугольный спинной плавник, пасть с зубами, хвост-полумесяц.
// 4 состояния через цвет/анимацию.

const SHARK_BODY: [number, number, number][] = [
  // y, x_start, width  — заливка
  [3, 11, 4],
  [4, 9, 7],
  [5, 8, 9],
  [6, 4, 16],
  [7, 3, 19],
  [8, 2, 21],
  [9, 1, 22],
  [10, 1, 22],
  [11, 2, 21],
  [12, 3, 19],
  [13, 4, 17],
  [14, 6, 13],
  [15, 8, 9],
  [16, 12, 5],
]

const BELLY: [number, number, number][] = [
  [11, 4, 16],
  [12, 6, 13],
  [13, 8, 9],
  [14, 10, 6],
  [15, 12, 3],
]

const TAIL: [number, number, number][] = [
  // хвостовой плавник полумесяц справа
  [4, 22, 4],
  [5, 22, 5],
  [6, 23, 5],
  [7, 24, 4],
  [8, 25, 3],
  [9, 26, 2],
  [10, 26, 2],
  [11, 25, 3],
  [12, 24, 4],
  [13, 23, 5],
  [14, 22, 5],
  [15, 22, 4],
]

const PEC_FIN: [number, number, number][] = [
  // нижний грудной плавник
  [12, 10, 4],
  [13, 11, 4],
  [14, 12, 3],
]

export function Mascot({
  state = 'idle',
  className,
}: {
  state?: 'idle' | 'thinking' | 'stream' | 'wait'
  className?: string
}) {
  const body =
    state === 'stream'
      ? 'var(--pixel-cyan)'
      : state === 'wait'
        ? 'var(--pixel-gold)'
        : state === 'thinking'
          ? 'var(--pixel-magenta)'
          : 'var(--pixel-indigo)'
  const belly = 'color-mix(in oklab, var(--card) 60%, var(--background))'
  const dark = 'color-mix(in oklab, var(--foreground) 35%, transparent)'

  return (
    <svg
      viewBox="0 0 32 20"
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      className={className}
    >
      {/* тело */}
      <g fill={body}>
        {SHARK_BODY.map(([y, x, w], i) => (
          <rect key={`b${i}`} x={x} y={y} width={w} height="1" />
        ))}
        {/* спинной плавник */}
        <rect x="13" y="1" width="2" height="1" />
        <rect x="12" y="2" width="4" height="1" />
        {/* грудной плавник */}
        {PEC_FIN.map(([y, x, w], i) => (
          <rect key={`p${i}`} x={x} y={y} width={w} height="1" />
        ))}
        {/* хвост */}
        {TAIL.map(([y, x, w], i) => (
          <rect key={`t${i}`} x={x} y={y} width={w} height="1" />
        ))}
      </g>

      {/* пузо — светлее */}
      <g fill={belly}>
        {BELLY.map(([y, x, w], i) => (
          <rect key={`bl${i}`} x={x} y={y} width={w} height="1" />
        ))}
      </g>

      {/* пасть — линия */}
      <g fill={dark}>
        <rect x="2" y="10" width="6" height="1" />
        <rect x="1" y="11" width="1" height="1" />
      </g>

      {/* зубы */}
      <g fill="var(--background)">
        <rect x="3" y="10" width="1" height="1" />
        <rect x="5" y="10" width="1" height="1" />
        <rect x="7" y="10" width="1" height="1" />
      </g>

      {/* глаз */}
      {state === 'wait' ? (
        <rect x="6" y="8" width="2" height="1" fill={dark} />
      ) : (
        <>
          <rect x="6" y="8" width="2" height="2" fill={dark} />
          <rect x="6" y="8" width="1" height="1" fill="var(--foreground)" />
        </>
      )}

      {/* жабры — три коротких штриха */}
      <g fill={dark}>
        <rect x="11" y="8" width="1" height="3" />
        <rect x="13" y="8" width="1" height="3" />
        <rect x="15" y="8" width="1" height="3" />
      </g>

      {/* блик на спине */}
      <g fill="color-mix(in oklab, white 50%, transparent)" opacity="0.4">
        <rect x="14" y="7" width="6" height="1" />
        <rect x="18" y="8" width="3" height="1" />
      </g>
    </svg>
  )
}
