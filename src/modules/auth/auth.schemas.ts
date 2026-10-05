import { z } from 'zod'

const email = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'E-mail inválido.' }))

export const registerSchema = z.object({
  name: z.string({ error: 'Informe seu nome.' }).trim().min(2, 'Informe seu nome.').max(80),
  email,
  password: z
    .string({ error: 'Informe a senha.' })
    .min(6, 'A senha precisa ter pelo menos 6 caracteres.')
    .max(72, 'A senha pode ter no máximo 72 caracteres.'),
})

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Informe a senha.' }).min(1, 'Informe a senha.'),
})
