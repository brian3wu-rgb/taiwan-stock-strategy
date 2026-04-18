interface Props {
  signal: 'LONG' | 'SHORT'
  size?: 'sm' | 'md'
}

/** 做多 / 做空標籤徽章 */
export default function SignalBadge({ signal, size = 'md' }: Props) {
  const isLong = signal === 'LONG'
  const base   = 'inline-flex items-center gap-1 font-bold rounded-full'
  const pad    = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  const color  = isLong
    ? 'bg-green-900/40 text-green-400 border border-green-800/60'
    : 'bg-red-900/40  text-red-400   border border-red-800/60'

  return (
    <span className={`${base} ${pad} ${color}`}>
      {isLong ? '▲' : '▼'} {isLong ? '做多' : '做空'}
    </span>
  )
}
