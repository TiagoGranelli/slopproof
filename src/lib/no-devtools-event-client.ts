type Unsubscribe = () => void

interface EventPayload<Payload> {
  payload: Payload
  pluginId: string
  type: string
}

export class EventClient {
  readonly #pluginId: string

  constructor(options: { readonly pluginId: string }) {
    this.#pluginId = options.pluginId
  }

  getPluginId(): string {
    return this.#pluginId
  }

  createEventPayload<Payload>(eventSuffix: string, payload: Payload): EventPayload<Payload> {
    return { payload, pluginId: this.#pluginId, type: `${this.#pluginId}:${eventSuffix}` }
  }

  emit(): void {}

  on(): Unsubscribe {
    return () => {}
  }

  onAll(): Unsubscribe {
    return () => {}
  }

  onAllPluginEvents(): Unsubscribe {
    return () => {}
  }
}
