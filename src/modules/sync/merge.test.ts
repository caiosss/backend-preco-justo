import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mergeDocs, normalize, type SyncDoc } from './merge.js'

const NOW = new Date('2026-11-02T12:00:00.000Z')
const T = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString()

const doc = (patch: Partial<SyncDoc>): SyncDoc => ({
  version: 1,
  business: null,
  supplies: [],
  expenses: [],
  tools: [],
  items: [],
  sales: [],
  dismissedTips: [],
  updatedAt: T(0),
  ...patch,
})

const ids = (list: { id: string }[]) => list.map((e) => e.id)
const negocio = (name: string) => ({ name, type: 'servico', weeklyHours: 40, hourlyRate: 30, targetMargin: 20 })

describe('mergeDocs', () => {
  test('sem nada no servidor, vale o aparelho com o relógio preenchido', () => {
    const merged = mergeDocs(null, doc({ items: [{ id: 'a' }], updatedAt: T(3) }), { now: NOW })
    assert.deepEqual(ids(merged.items), ['a'])
    assert.equal(merged.clock?.['items:a'], T(3))
  })

  test('celular e PC de versões antigas viram uma loja só', () => {
    const celular = doc({
      business: negocio('Studio da Ana'),
      items: [{ id: 'i1' }, { id: 'i2' }],
      supplies: [{ id: 's1' }],
      updatedAt: T(1),
    })
    const pc = doc({ business: negocio('Teste'), items: [{ id: 'i3' }], updatedAt: T(5) })

    const merged = mergeDocs(pc, celular, { now: NOW })
    assert.deepEqual(ids(merged.items), ['i3', 'i1', 'i2'])
    assert.deepEqual(ids(merged.supplies), ['s1'])
    // O PC é mais recente, mas o celular tem o negócio de verdade (mais coisa cadastrada)
    assert.equal(merged.business?.name, 'Studio da Ana')
    assert.equal(merged.updatedAt, T(5))
  })

  test('aparelho novo, sem negócio, não apaga o da conta', () => {
    const conta = doc({ business: negocio('Studio da Ana'), updatedAt: T(1) })
    const merged = mergeDocs(conta, doc({ updatedAt: T(9) }), { now: NOW })
    assert.equal(merged.business?.name, 'Studio da Ana')
  })

  test('cada aparelho editou um item diferente: as duas mudanças ficam', () => {
    const base = { items: [{ id: 'a', price: 10 }, { id: 'b', price: 20 }] }
    const servidor = doc({ ...base, items: [{ id: 'a', price: 11 }, { id: 'b', price: 20 }], updatedAt: T(4), clock: { 'items:a': T(4), 'items:b': T(1) } })
    const aparelho = doc({ ...base, items: [{ id: 'a', price: 10 }, { id: 'b', price: 22 }], updatedAt: T(5), clock: { 'items:a': T(1), 'items:b': T(5) } })

    const merged = mergeDocs(servidor, aparelho, { now: NOW })
    assert.deepEqual(merged.items, [{ id: 'a', price: 11 }, { id: 'b', price: 22 }])
  })

  test('exclusão feita em outro aparelho some daqui também', () => {
    const servidor = doc({ items: [], deleted: { 'items:a': T(4) }, clock: {}, updatedAt: T(4) })
    const aparelho = doc({ items: [{ id: 'a' }], clock: { 'items:a': T(2) }, updatedAt: T(2) })

    const merged = mergeDocs(servidor, aparelho, { now: NOW })
    assert.deepEqual(merged.items, [])
    assert.equal(merged.deleted?.['items:a'], T(4))
  })

  test('item editado depois de ser apagado em outro aparelho volta', () => {
    const servidor = doc({ deleted: { 'items:a': T(4) }, clock: {}, updatedAt: T(4) })
    const aparelho = doc({ items: [{ id: 'a', price: 9 }], clock: { 'items:a': T(6) }, updatedAt: T(6) })

    const merged = mergeDocs(servidor, aparelho, { now: NOW })
    assert.deepEqual(merged.items, [{ id: 'a', price: 9 }])
    assert.equal(merged.deleted?.['items:a'], undefined)
  })

  test('com relógio dos dois lados, vence o cadastro do negócio mais recente', () => {
    const servidor = doc({ business: negocio('Antigo'), items: [{ id: 'x' }, { id: 'y' }], clock: { business: T(2) }, updatedAt: T(2) })
    const aparelho = doc({ business: negocio('Novo'), clock: { business: T(3) }, updatedAt: T(3) })
    assert.equal(mergeDocs(servidor, aparelho, { now: NOW }).business?.name, 'Novo')
  })

  test('primeira sincronização de um aparelho: o negócio de teste dele não vence o da conta', () => {
    // O celular já sincronizou (tem relógio); o PC fez um cadastro rápido agora há pouco
    const conta = doc({ business: negocio('Studio da Ana'), items: [{ id: 'a' }, { id: 'b' }], clock: { business: T(1) }, updatedAt: T(1) })
    const pc = doc({ business: negocio('Teste'), clock: { business: T(8) }, updatedAt: T(8) })
    assert.equal(mergeDocs(conta, pc, { now: NOW, firstSync: true }).business?.name, 'Studio da Ana')
    // Depois da primeira vez, vale a mudança mais recente
    assert.equal(mergeDocs(conta, pc, { now: NOW }).business?.name, 'Teste')
  })

  test('exclusão continua valendo para aparelhos que ainda não souberam', () => {
    const servidor = doc({ deleted: { 'items:a': T(4) }, clock: {}, updatedAt: T(4) })
    const merged = mergeDocs(servidor, servidor, { now: NOW })
    assert.equal(merged.deleted?.['items:a'], T(4))
    // Um aparelho antigo que ainda tem o item (sem relógio, de antes da exclusão) não o traz de volta
    const antigo = doc({ items: [{ id: 'a' }], updatedAt: T(2) })
    assert.deepEqual(mergeDocs(merged, antigo, { now: NOW }).items, [])
  })

  test('dicas dispensadas em versões antigas se somam', () => {
    const merged = mergeDocs(doc({ dismissedTips: ['a'] }), doc({ dismissedTips: ['b', 'a'] }), { now: NOW })
    assert.deepEqual(merged.dismissedTips, ['a', 'b'])
  })

  test('juntar de novo o resultado não muda nada', () => {
    const servidor = doc({ business: negocio('Ana'), items: [{ id: 'a' }], updatedAt: T(1) })
    const aparelho = doc({ items: [{ id: 'b' }], deleted: { 'items:z': T(2) }, updatedAt: T(2) })
    const merged = mergeDocs(servidor, aparelho, { now: NOW })
    assert.deepEqual(mergeDocs(merged, merged, { now: NOW }), merged)
  })
})

describe('normalize', () => {
  test('esquece exclusões muito antigas', () => {
    const out = normalize(doc({ deleted: { 'items:velho': '2025-01-01T00:00:00.000Z', 'items:novo': T(1) } }), NOW)
    assert.deepEqual(out.deleted, { 'items:novo': T(1) })
  })
})
