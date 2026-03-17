import { NodeRunner, type NodeRunResult } from './base.js'
import type { NodeDefinition, ThirdPartyConfig } from '../../types/workflow.js'
import { isThirdPartyConfig } from '../../types/workflow.js'

export class ThirdPartyRunner extends NodeRunner {
  async run(
    node: NodeDefinition,
    context: Record<string, unknown>,
    sandbox: boolean
  ): Promise<NodeRunResult> {
    const config = node.config
    if (!isThirdPartyConfig(config)) {
      return { output: {}, error: 'Missing or invalid ThirdPartyConfig' }
    }

    // Sandbox mode: return mock response immediately
    if (sandbox && config.mock_response) {
      console.log(`[ThirdParty] ${node.id} — sandbox mock response returned`)
      return { output: config.mock_response }
    }

    const { max_attempts, backoff_base_seconds } = config.retry
    let lastError: string | undefined

    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      console.log(`[ThirdParty] ${node.id} attempt ${attempt}/${max_attempts} → ${config.method} ${config.url}`)
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          config.timeout_seconds * 1000
        )

        const fetchOptions: RequestInit = {
          method: config.method,
          headers: config.headers,
          signal: controller.signal,
        }

        if (config.body && config.method !== 'GET' && config.method !== 'HEAD') {
          fetchOptions.body = JSON.stringify(config.body)
          ;(fetchOptions.headers as Record<string, string>)['Content-Type'] =
            'application/json'
        }

        const response = await fetch(config.url, fetchOptions)
        clearTimeout(timeoutId)

        let responseBody: unknown
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          responseBody = await response.json()
        } else {
          responseBody = await response.text()
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)}`)
        }

        console.log(`[ThirdParty] ${node.id} attempt ${attempt} succeeded — status ${response.status}`)
        return {
          output: {
            status_code: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
          },
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < max_attempts) {
          const delay = backoff_base_seconds * Math.pow(2, attempt - 1) * 1000
          console.log(`[ThirdParty] ${node.id} attempt ${attempt} failed: ${lastError}. Retrying in ${delay}ms…`)
          await sleep(delay)
        } else {
          console.log(`[ThirdParty] ${node.id} attempt ${attempt} failed: ${lastError}. No more retries.`)
        }
      }
    }

    return { output: {}, error: `All ${max_attempts} attempts failed: ${lastError}` }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
