/**
 * Áreas do app usadas no painel de uso. A área é a aba da barra de navegação (ou a tela fora dela);
 * o caminho normalizado ("/itens/:id/editar") separa as telas dentro de cada área.
 */
const AREAS: [RegExp, string][] = [
  [/^\/$/, 'Início'],
  [/^\/vendas/, 'Vendas'],
  [/^\/itens/, 'Produtos e serviços'],
  [/^\/insumos/, 'Insumos'],
  [/^\/despesas/, 'Despesas'],
  [/^\/ajustes/, 'Ajustes'],
  [/^\/assistente/, 'Assistente'],
  [/^\/bem-vindo/, 'Primeiro cadastro'],
  [/^\/entrar/, 'Login e cadastro'],
  [/^\/(recuperar|redefinir)-senha/, 'Recuperar senha'],
  [/^\/termos/, 'Termos de uso'],
  [/^\/admin/, 'Admin'],
]

/** Tira a busca e troca ids por ":id", para somar a mesma tela de itens diferentes. */
export function normalizePath(path: string): string {
  const clean = (path.split(/[?#]/)[0] ?? '').slice(0, 200) || '/'
  const parts = clean.split('/').map((seg, i, all) =>
    i === 2 && all[1] === 'itens' && seg !== 'novo' && seg !== '' ? ':id' : seg,
  )
  const out = parts.join('/')
  return out.length > 1 ? out.replace(/\/$/, '') : out
}

export function areaOf(path: string): string {
  const p = normalizePath(path)
  return AREAS.find(([re]) => re.test(p))?.[1] ?? 'Outras'
}

/** Nome da tela para o painel (dentro de "Produtos e serviços" há lista, ficha e cadastro). */
export function screenOf(path: string): string {
  const p = normalizePath(path)
  if (p === '/itens/novo' || p === '/itens/:id/editar') return 'Cadastro de produto/serviço'
  if (p === '/itens/:id') return 'Ficha do produto/serviço (a conta)'
  if (p === '/itens') return 'Lista de produtos/serviços'
  return areaOf(p)
}

/** Coleções do pacote de dados (clock "items:<id>") → área do app onde a mudança foi feita. */
export const COLLECTION_AREA: Record<string, string> = {
  items: 'Produtos e serviços',
  supplies: 'Insumos',
  expenses: 'Despesas',
  tools: 'Despesas',
  sales: 'Vendas',
  business: 'Ajustes',
  dismissedTips: 'Início',
}
