import { z } from 'zod'

/**
 * Cópia de segurança dos dados do app (mesma estrutura do armazenamento local do PWA).
 * Os objetos são "loose" para aceitar campos novos de versões futuras do app.
 */
const withId = z.looseObject({ id: z.string().min(1) })

export const appDataSchema = z.looseObject({
  version: z.number().int().positive(),
  business: z
    .looseObject({
      name: z.string(),
      type: z.enum(['servico', 'producao']),
    })
    .nullable(),
  supplies: z.array(withId).max(2000),
  expenses: z.array(withId).max(500),
  tools: z.array(withId).max(500),
  items: z.array(withId).max(2000),
  // Fecho do dia (vendas/atendimentos). Backups antigos não têm o campo.
  sales: z.array(withId).max(20000).default([]),
  dismissedTips: z.array(z.string()).max(500).default([]),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const putBackupSchema = z.object({ data: appDataSchema })
