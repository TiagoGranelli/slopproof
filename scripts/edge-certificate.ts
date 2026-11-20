import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, getCACertificates, setDefaultCACertificates } from 'node:tls'

const ROOT_CERTIFICATE = 'caddy/pki/authorities/local/root.crt'

export const readRootCertificate = (container: string, dataHome: string | undefined): string => {
  if (dataHome) {
    const path = join(dataHome, 'data', ROOT_CERTIFICATE)
    if (!existsSync(path)) {
      throw new Error(`no root certificate at ${path} yet`)
    }
    return readFileSync(path, 'utf8')
  }
  const cat = spawnSync('docker', ['exec', container, 'cat', `/data/${ROOT_CERTIFICATE}`], { encoding: 'utf8' })
  if (cat.status !== 0 || !cat.stdout.includes('BEGIN CERTIFICATE')) {
    throw new Error(`no PEM root certificate at ${container}:/data/${ROOT_CERTIFICATE} yet (exit ${cat.status})`)
  }
  return cat.stdout
}

export const trustCertificateAuthority = (pem: string): void => {
  const current = getCACertificates('default')
  if (!current.includes(pem)) {
    setDefaultCACertificates([...current, pem])
  }
}

export const servedCertificateSpki = (port: string): Promise<string> =>
  new Promise<string>((resolveSpki, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port), servername: 'localhost' }, () => {
      const certificate = socket.getPeerX509Certificate()
      socket.end()
      if (!certificate) {
        reject(new Error(`the edge at 127.0.0.1:${port} sent no certificate for localhost`))
        return
      }
      resolveSpki(
        createHash('sha256')
          .update(certificate.publicKey.export({ format: 'der', type: 'spki' }))
          .digest('base64'),
      )
    }).once('error', reject)
  })
