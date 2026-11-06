import { createFamiliarStore, type FamiliarStore } from '@familiar-ai/client'

// Just enough UI to sign in, chat and set a plugin's secret. Text from the
// model and from tools is set as text, never as HTML.

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!

const signIn = $<HTMLFormElement>('#sign-in')
const app = $('#app')

const post = (path: string, body?: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

signIn.addEventListener('submit', async (event) => {
  event.preventDefault()
  const password = new FormData(signIn).get('password')
  const response = await post('/auth/sign-in', { password })
  if (response.ok) {
    start()
  } else {
    $('#sign-in .error').textContent = (await response.json()).error
  }
})

$('#sign-out').addEventListener('click', async () => {
  await post('/auth/sign-out')
  location.reload()
})

function start() {
  signIn.hidden = true
  app.hidden = false
  const store = createFamiliarStore('/api')

  store.subscribe((state) => {
    $('#status').textContent = state.transcript?.busy
      ? 'Thinking…'
      : state.connection
    $('#transcript').replaceChildren(
      ...(state.transcript?.items ?? []).flatMap((item) => {
        if (item.type !== 'message' && item.type !== 'reply') {
          return []
        }
        const li = document.createElement('li')
        const who = document.createElement('div')
        who.className = 'author'
        who.textContent =
          item.type === 'message' ? item.author.name : 'Familiar'
        li.append(who, item.text)
        return [li]
      }),
    )
  })

  const send = $<HTMLFormElement>('#send')
  send.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = String(new FormData(send).get('text'))
    send.reset()
    void store.conversation.send(text)
  })

  void showConnections(store)
}

/** Each plugin secret, whether it's set, and a box to set it. */
async function showConnections(store: FamiliarStore) {
  const connections = await store.connections.list()
  $('#connections').replaceChildren(
    ...connections.flatMap((connection) =>
      connection.secrets.map((secret) => {
        const li = document.createElement('li')
        const form = document.createElement('form')
        const input = document.createElement('input')
        input.type = 'password'
        input.placeholder = secret.set ? 'Set. Paste to replace' : secret.label
        const save = document.createElement('button')
        save.textContent = 'Save'
        form.append(`${connection.title}: ${secret.label}`, input, save)
        form.addEventListener('submit', async (event) => {
          event.preventDefault()
          await store.connections.setSecret(
            { kind: connection.kind, name: connection.name },
            secret.name,
            input.value,
          )
          void showConnections(store)
        })
        li.append(form)
        return li
      }),
    ),
  )
}

// Signed in already, from an earlier visit?
if ((await fetch('/auth/me')).ok) {
  start()
} else {
  signIn.hidden = false
}
