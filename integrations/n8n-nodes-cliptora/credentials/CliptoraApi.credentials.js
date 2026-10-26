'use strict'

class CliptoraApi {
  constructor() {
    this.name = 'cliptoraApi'
    this.displayName = 'CLIPTORA API'
    this.properties = [
      {
        displayName: 'API Base URL', name: 'baseUrl', type: 'string',
        default: 'http://host.docker.internal:5173/api/v1',
        description: 'Use CLIPTORA’s Vite URL from Docker; Vite securely proxies FastAPI.',
      },
      {
        displayName: 'Service Token', name: 'apiToken', type: 'string',
        typeOptions: { password: true }, default: '',
        description: 'Must match CLIPTORA_N8N_SERVICE_TOKEN in backend/.env.',
      },
    ]
  }
}

module.exports = { CliptoraApi }
