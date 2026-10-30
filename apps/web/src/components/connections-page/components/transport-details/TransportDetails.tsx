import type { TransportDetailsProps } from './types'

/** What a server was added with, which stays fixed for its lifetime. */
export const TransportDetails = ({ transport }: TransportDetailsProps) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    {transport.type === 'http' ? (
      <>
        <dt className="text-muted-foreground">URL</dt>
        <dd className="font-mono break-all">{transport.url}</dd>
        <dt className="text-muted-foreground">Sign-in</dt>
        <dd>{transport.auth.type === 'bearer' ? 'Bearer token' : 'None'}</dd>
      </>
    ) : (
      <>
        <dt className="text-muted-foreground">Command</dt>
        <dd className="font-mono break-all">{transport.command}</dd>
        <dt className="text-muted-foreground">Arguments</dt>
        <dd>
          {transport.args.length ? (
            <ol className="flex flex-col gap-1 font-mono break-all">
              {transport.args.map((arg, index) => (
                <li key={index}>{arg}</li>
              ))}
            </ol>
          ) : (
            'None'
          )}
        </dd>
      </>
    )}
  </dl>
)
