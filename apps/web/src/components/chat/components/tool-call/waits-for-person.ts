/** A computer call waiting for the person to hand the computer back. */
export const waitsForPerson = ({
  status,
  details,
}: {
  status: string
  details?: unknown
}) =>
  status === 'running' &&
  typeof details === 'object' &&
  details !== null &&
  'waiting' in details &&
  details.waiting === true
