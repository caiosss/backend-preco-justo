// Túnel de homologação usando o ngrok instalado na máquina (o authtoken vem do
// `ngrok config add-authtoken`). Usa NGROK_DOMAIN do .env quando definido.
import { spawn } from 'node:child_process'

const port = process.env.PORT || '3333'
const args = ['http', port]
if (process.env.NGROK_DOMAIN) args.push(`--url=${process.env.NGROK_DOMAIN}`)

console.log(`ngrok ${args.join(' ')}`)
const child = spawn('ngrok', args, { stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
