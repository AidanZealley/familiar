import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ConnectionStatus } from '../connection-status'

/** The logo, home to the catch-up: its cat hops while the pointer is on it. */
export const HomeLogo = () => {
  const [hovered, setHovered] = useState(false)

  return (
    <Link
      to="/"
      className="flex items-baseline gap-1"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <ConnectionStatus hopping={hovered} />
      familiar
    </Link>
  )
}
