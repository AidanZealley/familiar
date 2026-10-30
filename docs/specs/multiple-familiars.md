# Multiple Familiars and collaboration

Status: draft for later discussion. This records a direction, not an implementation commitment. Continue [easy install](easy-install.md) independently; this proposal does not change today's single-Familiar setup.

## Why

An owner should be able to keep several assistants with different roles, such as a general assistant, a researcher and a developer. Each keeps its own conversation and memory. The owner can talk to them individually, and later ask them to work together.

The current daemon, CLI and UI manage one Familiar. Core already accepts separate storage in `summonFamiliar`, so hosting several does not require changing the rule that each Familiar has one owner and one durable conversation. Role instructions and communication between Familiars still need implementing.

The immediate example came from trying setup on a machine that already ran Familiar: entering a new name renamed the existing assistant, and opening the URL showed the existing conversation. Future setup must make reuse, rename and creation distinct actions.

## Proposed direction

Run one service hosting multiple Familiars for the same owner. Share installation, networking and provider login at the host level. Give each Familiar a stable identity and separate durable state.

Start with independent assistants. Add collaboration as a later milestone, once creating, selecting and removing them works. Keep the core portable and Pi behind the existing `Familiar` API. Refer to the [architecture](../architecture.md) and [README rules](../../README.md#rules) when implementing.

### Ownership

| Responsibility                                                    | Owner                                               |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| Installation, service, HTTP listener and tailnet publication      | Host                                                |
| Familiar IDs, names, roles, settings and desired running state    | One host catalog                                    |
| Active instances, opening storage and closing instances           | One host manager, using the catalog                 |
| Conversation, memory, schedules and saved connection declarations | Each Familiar                                       |
| Provider login, installation ID and token refresh                 | Host credential/model service                       |
| Plugin credentials and MCP processes                              | Host storage and lifecycle, scoped to each Familiar |
| A delegated task and its delivery/result state                    | One durable host collaboration component            |
| Selected Familiar and its live conversation view                  | Client                                              |

The catalog persists choices. Runtime status comes from the manager, including startup failures. Avoid separate copies of names, roles or enabled flags in the CLI, service units and UI. Each store has one active owner, and stopping one Familiar closes its tools and storage without stopping the others.

## Independent Familiars

### Identity, role and storage

- Assign an immutable ID at creation. Display names can change without changing URLs, storage paths or references from other Familiars. Never use an entered name as a filesystem path.
- Save a name and role instructions for each Familiar. A role changes its stable prompt; it does not grant tool access or authorize actions.
- Keep conversation, facts, episodes, schedules, connection declarations and plugin credentials separate. Sharing information is an explicit operation.
- Keep explicit model choices per Familiar, while unspecified settings follow host defaults. Avoid copying resolved defaults into every catalog entry.
- Route notifications to the correct Familiar and open its conversation when the owner selects one.

A proposed storage layout has one directory per ID beneath the host data directory, plus the host catalog and shared provider credentials. Confirm the format before implementation. Per-Familiar export/import must identify which state travels, and leave host login credentials behind.

Share a provider login through one host-owned credential/model service with serialized refresh. Do not copy a rotating OAuth login into several independently managed credential stores. Verify the installed Pi APIs support concurrent use across instances before relying on this arrangement. Sharing a login also shares provider usage limits.

### CLI and setup

The following commands illustrate the intended behavior; their syntax is not settled:

```sh
familiar create Researcher --role "Research questions and report sources"
familiar list
familiar stop <id>
familiar start <id>
familiar rename <id> Scout
familiar delete <id>
```

`list` shows IDs, names, roles and runtime status, including stopped assistants and errors. Commands identify a single Familiar explicitly; an ambiguous name must not silently pick one. Decide whether display names must be unique before implementing name-based selection.

On an existing installation, default setup identifies the Familiar already present and offers to continue using it. Creating another or renaming one is an explicit choice. Installing or updating the application does not create or rename assistants as a side effect.

Starting and stopping an individual Familiar controls that assistant's background work as well as chat. A stopped assistant stays stopped across host restarts. Define how overdue schedules resume, using the existing schedule behavior wherever possible.

### UI and API

Use one host URL with routes that identify a Familiar by ID. The UI offers selection and management, and shows whose conversation is open. Chat, memory, schedules and Connections all use that selection.

Switching assistants replaces the client subscription and live store. A late event or pending send from the previous selection must not appear in the newly selected conversation. The API resolves every operation to one instance before using its existing owner API.

Do not add a port, operating-system service or ChatGPT login for each assistant. Multiple owners and public access still require a separate authentication design.

### Stop, remove and delete

Make these operations distinct:

- Stopping a Familiar preserves all of its state and permits starting it again.
- Uninstalling the application service preserves every Familiar's data and login, following the easy-install contract.
- Permanently deleting a Familiar removes its conversation, memory, schedules, credentials and other state scoped to it. It preserves the host login and every other Familiar.

Deletion requires the owner to select an ID, see the assistant's current name and what will be lost, and type that name before proceeding. An empty response or mismatch cancels. Keep the ID visible when names are duplicated. Offer export before deletion, and define whether a recoverable removal stage is preferable to immediate destruction.

An assistant cannot delete another assistant through ordinary conversation or collaboration tools. Owner management remains separate from model tools.

## Collaboration

For example, the owner asks a general assistant to have Researcher investigate an option and Developer assess implementation effort, then return a combined recommendation. A coordinator is a role an ordinary Familiar can take, not a mandatory extra assistant or a new service.

### Explicit communication

Provide a host-mediated delegation capability as a first-party plugin using the existing plugin interface. Give it a small host API through deliberate Familiar methods; never expose Pi's Harness to another assistant.

A task identifies its source, destination, request, supplied context and any limits. The receiving Familiar sees that it came from another assistant, rather than attributing it to the owner. The result returns to the requester and is visible in the owner's UI with its origin and task reference.

An assistant receives only the information supplied for the task and its own existing context. Delegation does not grant access to another assistant's transcript, memory, credentials or tools. Shared accounts do not make every tool available to every Familiar. Define how tool access is selected before offering role-based capabilities.

In the first collaboration milestone, let the owner choose which Familiars can communicate. Receiving a task does not authorize sensitive actions on the owner's behalf. Apply the project's action-approval policy when such tools exist.

### Durable tasks and limits

One component records task identity and state, deliveries and results. Use explicit states such as queued, running, completed, failed and cancelled, rather than flags that callers must synchronize. Decide the exact states around real delivery and cancellation behavior.

Use the existing durable task system where it fits. Inspect the pinned Pi interfaces before designing another queue or scheduler. Establish delivery and retry guarantees before implementation; a restart must not silently repeat a sensitive action or invent a completed result.

Bound delegation depth, concurrency and work per task. Make cancellation, timeout, failure and usage visible to the owner. The first version should support a single delegation hop. Nested delegation, automatic teams and assistants continuously messaging one another can wait.

A stopped destination does not silently start itself for a task. Decide whether to reject or visibly queue that task. Deleting an assistant must settle its outstanding tasks without losing the requester's record of what happened.

## Migration

Adopt the existing Familiar as the first catalog entry, preserving its current name, conversation, memory, schedules, login and connections. Migration must not reset or rename it.

Prefer registering the existing storage in place for the first migration if that avoids moving private files. Choose the final layout and compatibility behavior after inspecting the export/import work. Back up before a migration that moves or changes durable data, and make interrupted migration recoverable.

Existing URLs should continue to open the adopted Familiar. New routes use IDs. Explain any change to CLI defaults or environment-variable scope before deploying it.

## Suggested implementation milestones

1. **Host multiple independent instances.** Add the catalog, manager, scoped storage and HTTP routing. Done when two faux-model Familiars run together with isolated conversations and memory, and stopping or failing one leaves the other usable. Verify shared login refresh has one writer.
2. **Manage and select them.** Add CLI management, UI selection, notification routing and migration from the existing installation. Done when an owner can create, find, rename, stop, resume and safely delete a Familiar, with no events or queued sends crossing selections. Reinstall and update preserve their identities and data.
3. **Delegate one task.** Add explicit, visible, single-hop communication with durable task tracking and limits. Done when a coordinator receives a specialist's result, and restart, cancellation, unavailable destinations and duplicate delivery have defined, tested outcomes.

Use temporary storage and the existing faux provider for acceptance tests. Implementation and migration testing must leave the owner's running service and real data untouched until explicitly authorized.

## Decisions to revisit

- Exact catalog and storage format, default-selection behavior, CLI syntax and display-name uniqueness.
- How role edits affect the current conversation and whether role templates are useful.
- Shared versus per-Familiar provider/model configuration, plugin availability and credential grants.
- Recoverable removal versus immediate deletion, confirmation behavior for automation, and the scope of exports and imports.
- Communication permissions, task budgets, delivery guarantees and behavior when either participant stops or is deleted.
- Which management actions belong in the first UI milestone. This draft does not choose a layout.

## Outside this proposal

Different owners sharing one unauthenticated daemon, cross-machine assistant discovery, unrestricted access to each other's memories, and autonomous recursive teams. These need their own requirements before implementation.
