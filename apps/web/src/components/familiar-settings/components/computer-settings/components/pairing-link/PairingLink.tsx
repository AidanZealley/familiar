import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import { CopyBlock } from '../copy-block'
import type { PairingLinkProps } from './types'

/** How to connect a machine: the command that runs the agent with its link. */
export const PairingLink = ({ link }: PairingLinkProps) => (
  <Field>
    <FieldTitle>Connect a machine</FieldTitle>
    <FieldDescription>
      Run this on the machine to use, with Node installed. The link works only
      for this computer, so keep it private. Pairing again replaces it.
    </FieldDescription>
    <CopyBlock
      text={`npx @familiar-ai/computer '${link}'`}
      label="Copy the command"
    />
    <FieldDescription>The link on its own:</FieldDescription>
    <CopyBlock text={link} label="Copy the link" />
  </Field>
)
