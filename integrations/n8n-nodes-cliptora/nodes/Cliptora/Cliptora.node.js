'use strict'

class Cliptora {
  constructor() {
    this.description = {
      displayName: 'CLIPTORA Video Tools', name: 'cliptora', icon: 'file:cliptora.svg',
      group: ['transform'], version: 1, subtitle: '={{$parameter["operation"]}}',
      description: 'Read CLIPTORA projects and run authenticated video-processing jobs',
      defaults: { name: 'CLIPTORA Video Tools' },
      inputs: ['main'], outputs: ['main'],
      credentials: [{ name: 'cliptoraApi', required: true }],
      properties: [
        {
          displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
          options: [
            { name: 'Get Project', value: 'getProject', action: 'Get a CLIPTORA project' },
            { name: 'Get Timeline', value: 'getTimeline', action: 'Get a CLIPTORA timeline' },
            { name: 'Extract Audio', value: 'extractAudio', action: 'Start an FFmpeg audio extraction job' },
            { name: 'Check Job Status', value: 'jobStatus', action: 'Check a CLIPTORA background job' },
          ], default: 'getProject',
        },
        {
          displayName: 'Project ID', name: 'projectId', type: 'number',
          typeOptions: { minValue: 1, numberPrecision: 0 }, required: true, default: 1,
          displayOptions: { show: { operation: ['getProject', 'getTimeline', 'extractAudio'] } },
        },
        {
          displayName: 'Video Media Asset ID', name: 'mediaAssetId', type: 'number',
          typeOptions: { minValue: 1, numberPrecision: 0 }, required: true, default: 1,
          description: 'The uploaded CLIPTORA video asset ID; file paths never enter the workflow.',
          displayOptions: { show: { operation: ['extractAudio'] } },
        },
        {
          displayName: 'Job ID', name: 'jobId', type: 'number',
          typeOptions: { minValue: 1, numberPrecision: 0 }, required: true, default: 1,
          displayOptions: { show: { operation: ['jobStatus'] } },
        },
      ],
    }
  }

  async execute() {
    const credentials = await this.getCredentials('cliptoraApi')
    const baseUrl = String(credentials.baseUrl).replace(/\/$/, '')
    const token = String(credentials.apiToken)
    if (!baseUrl || !token) throw new Error('CLIPTORA API credentials are incomplete')
    const items = this.getInputData()
    const output = []
    for (let index = 0; index < Math.max(items.length, 1); index += 1) {
      const operation = this.getNodeParameter('operation', index)
      let method = 'GET'
      let path = ''
      let body
      if (operation === 'jobStatus') {
        path = `/n8n/tools/jobs/${this.getNodeParameter('jobId', index)}`
      } else {
        const projectId = this.getNodeParameter('projectId', index)
        if (operation === 'getProject') path = `/n8n/tools/projects/${projectId}`
        if (operation === 'getTimeline') path = `/n8n/tools/projects/${projectId}/timeline`
        if (operation === 'extractAudio') {
          method = 'POST'
          path = `/n8n/tools/projects/${projectId}/jobs/extract-audio`
          body = { media_asset_id: this.getNodeParameter('mediaAssetId', index) }
        }
      }
      try {
        const response = await this.helpers.request({
          method, uri: `${baseUrl}${path}`,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          body, json: true,
        })
        output.push({ json: response, pairedItem: { item: index } })
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: index } })
          continue
        }
        throw error
      }
    }
    return [output]
  }
}

module.exports = { Cliptora }
